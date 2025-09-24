/**
 * Curling analytics tool for querying the database
 */
import { tool, type ToolSet } from "ai";
import { z } from "zod/v3";
import { env } from "cloudflare:workers";

/**
 * Read-only database query tool that executes automatically
 * This allows safe SELECT queries against the curling database without confirmation
 */
const queryDatabase = tool({
  description: `Execute SELECT queries against the curling analytics database. This contains comprehensive curling match data including shot-by-shot analysis, stone positions, and performance metrics.
    
    CURLING CONTEXT:
    - Curling is played with 8 stones per team (red vs yellow) over 10 ends
    - Each player throws 2 stones per end (16 total stones per end)
    - Teams alternate throwing, with the team having 'hammer' (last stone advantage) going last
    - Shots are scored 0-100% based on execution quality
    - Stone positions are tracked with x,y coordinates relative to the button (center of target)
    
    DATA QUALITY NOTES:
    - Some games have final_score_red/final_score_yellow as 'NaN' (string, not NULL) - filter these out
    - Score of 999 represents a Win/Loss game (999=Win, 0=Loss)
    - Some ends have color_hammer = 'error_color' - these are parsing errors, filter out if needed
    - Turn column has two formats: 'Clockwise'/'Counter-clockwise' OR 'In'/'Out' (depends on handedness)
    - Time values (time_left_red/yellow) may be 'NaN' for some games missing score data
    - Join pattern: games -> ends -> shots -> stone_positions (use proper JOINs)
    
    DATABASE SCHEMA:
    
    CREATE TABLE IF NOT EXISTS events(
        id INTEGER PRIMARY KEY,
        name TEXT,
        start_date TEXT,
        end_date TEXT
    );
    
    CREATE TABLE IF NOT EXISTS games(
        id INTEGER PRIMARY KEY,
        event_id INTEGER,
        session TEXT,
        name TEXT,
        sheet TEXT,
        type TEXT,
        start_date TEXT,
        start_time TEXT,
        team_red TEXT,
        team_yellow TEXT,
        final_score_red INTEGER,
        final_score_yellow INTEGER,
        FOREIGN KEY (event_id) REFERENCES events(id)
    );
    
    CREATE TABLE IF NOT EXISTS ends(
        id INTEGER PRIMARY KEY,
        game_id INTEGER,
        number INTEGER,
        direction INTEGER,
        color_hammer TEXT,
        score_red INTEGER,
        score_yellow INTEGER,
        time_left_red INTEGER,
        time_left_yellow INTEGER,
        FOREIGN KEY (game_id) REFERENCES games(id)
    );
    
    CREATE TABLE IF NOT EXISTS shots(
        id INTEGER PRIMARY KEY,
        end_id INTEGER,
        number INTEGER,
        color TEXT,
        team TEXT,
        player_name TEXT,
        type TEXT,
        turn TEXT,
        percent_score REAL,
        FOREIGN KEY (end_id) REFERENCES ends(id)
    );
    
    CREATE TABLE IF NOT EXISTS stone_positions(
        id INTEGER PRIMARY KEY,
        shot_id INTEGER,
        color TEXT,
        x REAL,
        y REAL,
        FOREIGN KEY (shot_id) REFERENCES shots(id)
    );`,
  inputSchema: z.object({
    query: z
      .string()
      .describe(
        "The SELECT SQL query to execute. Only SELECT statements are allowed."
      ),
    params: z
      .array(z.any())
      .optional()
      .describe(
        "Optional parameters for the SQL query to prevent SQL injection"
      )
  }),
  execute: async ({ query, params }) => {
    try {
      // Validate that this is a SELECT query
      const trimmedQuery = query.trim().toLowerCase();
      if (!trimmedQuery.startsWith("select")) {
        return {
          success: false,
          error:
            "Only SELECT queries are allowed with this tool. Use querySQLiteDatabase for other operations."
        };
      }

      const db = env.DB;
      if (!db) {
        return {
          success: false,
          error: "Database not configured. Please set up D1 binding."
        };
      }

      // Execute the query with optional parameters
      const result =
        params && params.length > 0
          ? await db
              .prepare(query)
              .bind(...params)
              .all()
          : await db.prepare(query).all();

      return {
        success: true,
        rows: result.results,
        count: result.results?.length || 0,
        meta: result.meta
      };
    } catch (error) {
      console.error("Database query error:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
});

/**
 * Query shot details with all related information via joins
 */
const queryShotDetails = tool({
  description: `Query detailed information about a specific shot including game, player, team, and stone positions.
    This tool automatically performs the necessary joins to get comprehensive shot data.`,
  inputSchema: z.object({
    shotId: z.number().describe("The ID of the shot to query")
  }),
  execute: async ({ shotId }) => {
    try {
      const db = env.DB;
      if (!db) {
        return {
          success: false,
          error: "Database not configured. Please set up D1 binding."
        };
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

      const shotResult = await db.prepare(shotQuery).bind(shotId).first();

      if (!shotResult) {
        return {
          success: false,
          error: `Shot with ID ${shotId} not found`
        };
      }

      // Query stone positions for this shot
      const stoneQuery = `
        SELECT color, x, y
        FROM stone_positions
        WHERE shot_id = ?
        ORDER BY id
      `;

      const stoneResult = await db.prepare(stoneQuery).bind(shotId).all();

      return {
        success: true,
        shot: shotResult,
        stones: stoneResult.results || [],
        count: (stoneResult.results || []).length
      };
    } catch (error) {
      console.error("Shot details query error:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
});

/**
 * Visualization tool for rendering curling shots in the UI
 */
const visualizeCurlingShot = tool({
  description: `Visualize a curling shot with stone positions on the curling house. 
    This will render the stones on the left side of the chat interface.
    Use this after querying stone positions from the database to show the visual state of the game.`,
  inputSchema: z.object({
    shotId: z.number().describe("The ID of the shot being visualized"),
    player: z.string().describe("The name of the player taking the shot"),
    team: z.string().describe("The team name (3-letter code)"),
    shotType: z
      .string()
      .describe("The type of shot (e.g., Draw, Take-out, etc.)"),
    stones: z
      .array(
        z.object({
          color: z.enum(["red", "yellow"]).describe("The color of the stone"),
          x: z.number().describe("X coordinate relative to button (center)"),
          y: z.number().describe("Y coordinate relative to button (center)")
        })
      )
      .describe("Array of stone positions after this shot")
  }),
  execute: async ({ shotId, player, team, shotType, stones }) => {
    // This tool triggers a UI update via the result
    return {
      success: true,
      visualization: {
        shotId,
        player,
        team,
        shotType,
        stones
      },
      message: `Visualized shot ${shotId} by ${player} (${team}): ${shotType} with ${stones.length} stones in play.`
    };
  }
});

/**
 * Tool to update the current shot ID in the UI
 */
const setShotId = tool({
  description: `Update the current shot ID in the UI. Use this when the user asks about a specific shot by ID number, 
    or when you want to show a particular shot in the curling house visualization. 
    This will automatically load and display the shot data in the curling house on the left side.`,
  inputSchema: z.object({
    shotId: z.number().describe("The shot ID to display in the UI"),
    reason: z
      .string()
      .optional()
      .describe("Optional reason for updating the shot ID")
  }),
  execute: async ({ shotId, reason }) => {
    return {
      success: true,
      shotId: shotId,
      message: reason || `Updated display to show shot ${shotId}`,
      updateShotId: true
    };
  }
});

/**
 * Export available tools - database query, shot details, visualization, and shot ID setting
 */
export const tools = {
  queryDatabase,
  queryShotDetails,
  visualizeCurlingShot,
  setShotId
} satisfies ToolSet;

/**
 * No tools require human confirmation, so executions object is empty
 */
export const executions = {};
