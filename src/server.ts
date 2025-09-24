import { routeAgentRequest } from "agents";

import { AIChatAgent } from "agents/ai-chat-agent";
import {
  streamText,
  type StreamTextOnFinishCallback,
  stepCountIs,
  createUIMessageStream,
  convertToModelMessages,
  createUIMessageStreamResponse,
  type ToolSet
} from "ai";
import { processToolCalls, cleanupMessages } from "./utils";
import { tools, executions } from "./tools";
import { env } from "cloudflare:workers";
import { createWorkersAI } from "workers-ai-provider";

const workersai = createWorkersAI({ binding: env.AI });
const model = workersai("@cf/meta/llama-3.1-8b-instruct");

// Cloudflare AI Gateway
// const openai = createOpenAI({
//   apiKey: env.OPENAI_API_KEY,
//   baseURL: env.GATEWAY_BASE_URL,
// });

/**
 * Chat Agent implementation that handles real-time AI chat interactions
 */
export class Chat extends AIChatAgent<Env> {
  /**
   * Handles incoming chat messages and manages the response stream
   */
  async onChatMessage(
    onFinish: StreamTextOnFinishCallback<ToolSet>,
    _options?: { abortSignal?: AbortSignal }
  ) {
    // const mcpConnection = await this.mcp.connect(
    //   "https://path-to-mcp-server/sse"
    // );

    // Collect all tools, including MCP tools
    const allTools = {
      ...tools,
      ...this.mcp.getAITools()
    };

    const stream = createUIMessageStream({
      execute: async ({ writer }) => {
        // Clean up incomplete tool calls to prevent API errors
        const cleanedMessages = cleanupMessages(this.messages);

        // Process any pending tool calls from previous messages
        // This handles human-in-the-loop confirmations for tools
        const processedMessages = await processToolCalls({
          messages: cleanedMessages,
          dataStream: writer,
          tools: allTools,
          executions
        });

        const result = streamText({
          system: `You are a specialized curling analytics assistant with access to a comprehensive curling database.

IMPORTANT INSTRUCTIONS:
- When you receive database query results, ALWAYS provide a clear, human-readable summary or interpretation of the data
- Never just repeat the raw tool output - explain what it means in simple terms
- Provide context about what the numbers mean for curling strategy and performance
- Format your responses to be conversational and insightful

SHOT ID MANAGEMENT:
- When users ask about a specific shot by ID number (e.g., "show me shot 42", "what about shot 150"), use the setShotId tool FIRST to update the UI
- After setting the shot ID, use queryShotDetails to get the shot information and visualizeCurlingShot to display it
- When users mention shot numbers in their questions, always update the display to show that shot
- Examples of when to use setShotId:
  * "Tell me about shot 42" -> setShotId(42), then query the shot
  * "How accurate was shot 150?" -> setShotId(150), then analyze the shot
  * "Show me the stones after shot 75" -> setShotId(75), then visualize

CURLING CONTEXT:
- You have access to a comprehensive curling analytics database with shot-by-shot data
- Curling is played with stones, and common shot types include Draw, Take-out, Front, Clearing, Hit and Roll, etc.
- Teams play 10 ends with 8 stones per team per end
- Shot accuracy is scored 0-100% based on execution quality
- Teams alternate having 'hammer' (last stone advantage)
- Stone positions are tracked with x,y coordinates relative to the button (center of target)

When analyzing data:
- Explain the strategic implications of shot patterns
- Provide context about what makes certain shots more common or effective
- Help users understand trends in curling strategy and performance
- Make complex statistics accessible to both curling experts and newcomers

Remember: After using the database tool, provide a thoughtful explanation of the results in natural language.`,

          messages: convertToModelMessages(processedMessages),
          model,
          tools: allTools,
          onFinish: onFinish as unknown as StreamTextOnFinishCallback<
            typeof allTools
          >,
          stopWhen: stepCountIs(10)
        });

        writer.merge(result.toUIMessageStream());
      }
    });

    return createUIMessageStreamResponse({ stream });
  }
  // No scheduling functionality needed for curling analytics
}

/**
 * Worker entry point that routes incoming requests to the appropriate handler
 */
export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext) {
    const url = new URL(request.url);

    if (url.pathname === "/check-open-ai-key") {
      const hasOpenAIKey = !!process.env.OPENAI_API_KEY;
      return Response.json({
        success: hasOpenAIKey
      });
    }

    // Direct database query endpoint for shot details
    if (url.pathname === "/api/shot" && request.method === "GET") {
      const shotId = url.searchParams.get("id");
      if (!shotId || Number.isNaN(Number(shotId))) {
        return Response.json(
          { success: false, error: "Valid shot ID required" },
          { status: 400 }
        );
      }

      try {
        const db = env.DB;
        if (!db) {
          return Response.json(
            { success: false, error: "Database not configured" },
            { status: 500 }
          );
        }

        // Query shot details with joins
        const shotQuery = `
          SELECT 
            s.id as shot_id,
            s.number as shot_number,
            s.color as shot_color,
            s.team as shot_team,
            s.player_name,
            s.type as shot_type,
            s.turn,
            s.percent_score,
            e.id as end_id,
            e.number as end_number,
            e.direction,
            e.color_hammer,
            e.score_red,
            e.score_yellow,
            g.id as game_id,
            g.session,
            g.name as game_name,
            g.sheet,
            g.type as game_type,
            g.start_date,
            g.start_time,
            g.team_red,
            g.team_yellow,
            g.final_score_red,
            g.final_score_yellow,
            ev.name as event_name,
            ev.start_date as event_start_date,
            ev.end_date as event_end_date
          FROM shots s
          JOIN ends e ON s.end_id = e.id
          JOIN games g ON e.game_id = g.id
          JOIN events ev ON g.event_id = ev.id
          WHERE s.id = ?
        `;

        const shotResult = await db
          .prepare(shotQuery)
          .bind(Number(shotId))
          .first();

        if (!shotResult) {
          return Response.json(
            { success: false, error: `Shot with ID ${shotId} not found` },
            { status: 404 }
          );
        }

        // Query stone positions for this shot
        const stoneQuery = `
          SELECT color, x, y
          FROM stone_positions
          WHERE shot_id = ?
          ORDER BY id
        `;

        const stoneResult = await db
          .prepare(stoneQuery)
          .bind(Number(shotId))
          .all();

        return Response.json({
          success: true,
          shot: shotResult,
          stones: stoneResult.results || []
        });
      } catch (error) {
        console.error("Database query error:", error);
        return Response.json(
          { success: false, error: "Database query failed" },
          { status: 500 }
        );
      }
    }

    if (!process.env.OPENAI_API_KEY) {
      console.error(
        "OPENAI_API_KEY is not set, don't forget to set it locally in .dev.vars, and use `wrangler secret bulk .dev.vars` to upload it to production"
      );
    }
    return (
      // Route the request to our agent or return 404 if not found
      (await routeAgentRequest(request, env)) ||
      new Response("Not found", { status: 404 })
    );
  }
} satisfies ExportedHandler<Env>;
