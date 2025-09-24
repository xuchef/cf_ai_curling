/** biome-ignore-all lint/correctness/useUniqueElementIds: it's alright */
import { useEffect, useState, useRef, useCallback } from "react";
import { useAgent } from "agents/react";
import { isToolUIPart } from "ai";
import { useAgentChat } from "agents/ai-react";
import type { UIMessage } from "@ai-sdk/react";
import type { tools } from "./tools";

// Type definitions
interface ShotData {
  success: boolean;
  shot?: {
    shot_id: number;
    shot_number: number;
    shot_color: string;
    shot_team: string;
    player_name: string;
    shot_type: string;
    turn: string;
    percent_score: number;
    end_number: number;
    color_hammer: string;
    event_name: string;
  };
  stones?: Array<{ color: "red" | "yellow"; x: number; y: number }>;
  error?: string;
}

interface CurrentShot {
  stones?: Array<{ color: "red" | "yellow"; x: number; y: number }>;
  shot?: ShotData["shot"];
  shotInfo?: {
    player: string;
    team: string;
    type: string;
    shotId: number;
  };
}

// Component imports
import { Button } from "@/components/button/Button";
import { Card } from "@/components/card/Card";
import { Avatar } from "@/components/avatar/Avatar";
import { Toggle } from "@/components/toggle/Toggle";
import { Textarea } from "@/components/textarea/Textarea";
import { MemoizedMarkdown } from "@/components/memoized-markdown";
import { ToolInvocationCard } from "@/components/tool-invocation-card/ToolInvocationCard";
import { CurlingHouse } from "@/components/curling-house/CurlingHouse";

// Icon imports
import { Bug, Robot, Trash, PaperPlaneTilt, Stop } from "@phosphor-icons/react";

// List of tools that require human confirmation
// NOTE: this should match the tools that don't have execute functions in tools.ts
const toolsRequiringConfirmation: (keyof typeof tools)[] = [
  // No tools require confirmation for curling analytics
];

export default function Chat() {
  const [_theme] = useState<"dark" | "light">("light");
  const [showDebug, setShowDebug] = useState(false);
  const [textareaHeight, setTextareaHeight] = useState("auto");
  const [currentShot, setCurrentShot] = useState<CurrentShot | null>(null);
  const [shotId, setShotId] = useState(42);
  const [processedToolCalls, setProcessedToolCalls] = useState<Set<string>>(
    new Set()
  );
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    // Force light mode only
    document.documentElement.classList.remove("dark");
    document.documentElement.classList.add("light");
  }, []);

  // Scroll to bottom on mount
  useEffect(() => {
    scrollToBottom();
  }, [scrollToBottom]);

  const agent = useAgent({
    agent: "chat"
  });

  const [agentInput, setAgentInput] = useState("");
  const handleAgentInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    setAgentInput(e.target.value);
  };

  const handleAgentSubmit = async (
    e: React.FormEvent,
    extraData: Record<string, unknown> = {}
  ) => {
    e.preventDefault();
    if (!agentInput.trim()) return;

    const message = agentInput;
    setAgentInput("");

    // Send message to agent
    await sendMessage(
      {
        role: "user",
        parts: [{ type: "text", text: message }]
      },
      {
        body: extraData
      }
    );
  };

  const {
    messages: agentMessages,
    addToolResult,
    clearHistory,
    status,
    sendMessage,
    stop
  } = useAgentChat<unknown, UIMessage<{ createdAt: string }>>({
    agent
  });

  const handleShotQuery = useCallback(
    async (shotId: number) => {
      try {
        // Make direct API call to query the shot
        const response = await fetch(`/api/shot?id=${shotId}`);
        const data = (await response.json()) as ShotData;

        if (data.success && data.shot && data.stones) {
          // Update the curling house visualization directly
          setCurrentShot(data);

          // Send a summary message to the chat
          // await sendMessage(
          //   {
          //     role: "user",
          //     parts: [
          //       {
          //         type: "text",
          //         text: `Shot ${shotId} loaded: ${data.shot.player_name} (${data.shot.shot_team}) - ${data.shot.shot_type} with ${data.stones.length} stones in play. Game: ${data.shot.event_name}, End ${data.shot.end_number}, ${data.shot.percent_score}% accuracy.`
          //       }
          //     ]
          //   },
          //   {}
          // );
        } else {
          // Send error message to chat
          await sendMessage(
            {
              role: "user",
              parts: [
                {
                  type: "text",
                  text: `Error: ${data.error || `Shot ${shotId} not found`}`
                }
              ]
            },
            {}
          );
        }
      } catch (error) {
        console.error("Failed to query shot:", error);
        await sendMessage(
          {
            role: "user",
            parts: [
              {
                type: "text",
                text: `Error querying shot ${shotId}: ${error instanceof Error ? error.message : "Unknown error"}`
              }
            ]
          },
          {}
        );
      }
    },
    [sendMessage]
  );

  // Load initial shot on mount
  useEffect(() => {
    if (shotId) {
      handleShotQuery(shotId);
    }
  }, [handleShotQuery, shotId]);

  // Scroll to bottom when messages change
  useEffect(() => {
    agentMessages.length > 0 && scrollToBottom();
  }, [agentMessages, scrollToBottom]);

  // Listen for tool results and update curling house
  useEffect(() => {
    // Check all messages for tool results, not just the last one
    agentMessages.forEach((message) => {
      if (message.role === "assistant") {
        message.parts?.forEach((part) => {
          if (isToolUIPart(part) && part.state === "output-available") {
            const toolCallId = part.toolCallId;

            // Skip if we've already processed this tool call
            if (processedToolCalls.has(toolCallId)) {
              return;
            }

            const result = part.output as Record<string, unknown>;

            // Debug logging
            console.log("Tool result detected:", part.type, result);

            // Handle visualization tool results
            if (
              part.type === "tool-visualizeCurlingShot" &&
              result?.success &&
              result?.visualization
            ) {
              const viz = result.visualization as {
                stones: Array<{
                  color: "red" | "yellow";
                  x: number;
                  y: number;
                }>;
                player: string;
                team: string;
                shotType: string;
                shotId: number;
              };
              console.log("Setting current shot from visualization:", viz);
              setCurrentShot({
                stones: viz.stones,
                shotInfo: {
                  player: viz.player,
                  team: viz.team,
                  type: viz.shotType,
                  shotId: viz.shotId
                }
              });
              // Mark this tool call as processed
              setProcessedToolCalls((prev) => new Set(prev).add(toolCallId));
            }

            // Handle setShotId tool results
            if (
              part.type === "tool-setShotId" &&
              result?.success &&
              result?.updateShotId
            ) {
              const newShotId = result.shotId as number;
              console.log("Setting shot ID from tool:", newShotId);
              setShotId(newShotId);
              // Automatically load the shot data
              handleShotQuery(newShotId);
              // Mark this tool call as processed
              setProcessedToolCalls((prev) => new Set(prev).add(toolCallId));
            }
          }
        });
      }
    });
  }, [agentMessages, handleShotQuery, processedToolCalls]);

  const pendingToolCallConfirmation = agentMessages.some((m: UIMessage) =>
    m.parts?.some(
      (part) =>
        isToolUIPart(part) &&
        part.state === "input-available" &&
        // Manual check inside the component
        toolsRequiringConfirmation.includes(
          part.type.replace("tool-", "") as keyof typeof tools
        )
    )
  );

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div className="w-full min-h-screen flex justify-center items-center p-5">
      <div className="flex gap-4 w-full max-w-6xl">
        <div className="dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-800 rounded-md flex-shrink-0 p-4">
          <CurlingHouse
            stones={
              (currentShot?.stones || []) as Array<{
                color: "red" | "yellow";
                x: number;
                y: number;
              }>
            }
            shotInfo={currentShot?.shot}
            onShotQuery={handleShotQuery}
          />
        </div>

        {/* <pre className="overflow-auto text-sm">
          <code>{JSON.stringify(currentShot, null, 4)}</code>
        </pre> */}

        {/* Chat Interface - Right Side */}
        <div className="flex-1 flex flex-col border border-neutral-300 dark:border-neutral-800 rounded-md overflow-hidden h-[660px]">
          <div className="px-4 py-3 border-b border-neutral-300 dark:border-neutral-800 flex items-center gap-3 sticky top-0 z-10 flex-shrink-0">
            <div className="flex items-center justify-center h-8 w-8">
              <img src="/curling.svg" alt="Curling" width={28} height={28} />
            </div>

            <div className="flex-1">
              <h2 className="font-semibold text-base">Curling Analytics</h2>
            </div>

            {/* Shot ID Input */}
            <div className="flex items-center gap-2">
              <label htmlFor="shot-id-input" className="text-sm font-medium">
                Shot ID:
              </label>
              <input
                id="shot-id-input"
                type="number"
                value={shotId}
                onChange={(e) => {
                  const value = e.target.value;
                  setShotId(parseInt(value, 10));

                  const id = parseInt(value, 10);
                  if (!Number.isNaN(id)) {
                    handleShotQuery(id);
                  }
                }}
                placeholder="Enter Shot ID"
                className="w-20 px-2 py-1 text-sm border border-gray-300 rounded dark:border-neutral-600 dark:bg-neutral-800 dark:text-white"
                min="0"
              />
            </div>

            <div className="flex items-center gap-2 mr-2">
              <Bug size={16} />
              <Toggle
                toggled={showDebug}
                aria-label="Toggle debug mode"
                onClick={() => setShowDebug((prev) => !prev)}
              />
            </div>

            <Button
              variant="ghost"
              size="md"
              shape="square"
              className="rounded-full h-9 w-9"
              onClick={clearHistory}
            >
              <Trash size={20} />
            </Button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
            {agentMessages.length === 0 && (
              <div className="flex items-center justify-center">
                <Card className="p-6 max-w-md mx-auto bg-neutral-100 dark:bg-neutral-900">
                  <div className="text-center space-y-4">
                    <div className="bg-[#F48120]/10 text-[#F48120] rounded-full p-3 inline-flex">
                      <Robot size={24} />
                    </div>
                    <h3 className="font-semibold text-lg">
                      Curling Analytics Agent
                    </h3>
                    <p className="text-muted-foreground text-sm">
                      This agent has access to every world curling game played.
                      <br /> Ask it some stuff!
                    </p>
                    <ul className="text-sm text-left space-y-2">
                      <li className="flex items-center gap-2">
                        <span className="text-[#F48120]">•</span>
                        <span>Most common shot types</span>
                      </li>
                      <li className="flex items-center gap-2">
                        <span className="text-[#F48120]">•</span>
                        <span>Player performance statistics</span>
                      </li>
                      <li className="flex items-center gap-2">
                        <span className="text-[#F48120]">•</span>
                        <span>Team win/loss records</span>
                      </li>
                      <li className="flex items-center gap-2">
                        <span className="text-[#F48120]">•</span>
                        <span>Shot accuracy by end or player</span>
                      </li>
                    </ul>
                  </div>
                </Card>
              </div>
            )}

            {agentMessages.map((m, index) => {
              const isUser = m.role === "user";
              const showAvatar =
                index === 0 || agentMessages[index - 1]?.role !== m.role;

              return (
                <div key={m.id}>
                  {showDebug && (
                    <pre className="text-xs text-muted-foreground overflow-scroll">
                      {JSON.stringify(m, null, 2)}
                    </pre>
                  )}
                  <div
                    className={`flex ${isUser ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`flex gap-2 max-w-[85%] ${
                        isUser ? "flex-row-reverse" : "flex-row"
                      }`}
                    >
                      {showAvatar && !isUser ? (
                        <div className="w-8 h-8 flex-shrink-0">
                          <Avatar
                            username={"AI"}
                            size="sm"
                            className="w-full h-full"
                          />
                        </div>
                      ) : (
                        !isUser && <div className="w-8 h-8 flex-shrink-0" />
                      )}

                      <div>
                        <div>
                          {m.parts?.map((part, i) => {
                            if (part.type === "text") {
                              return (
                                // biome-ignore lint/suspicious/noArrayIndexKey: immutable index
                                <div key={i}>
                                  <Card
                                    className={`p-3 rounded-md bg-neutral-100 dark:bg-neutral-900 ${
                                      isUser
                                        ? "rounded-br-none"
                                        : "rounded-bl-none border-assistant-border"
                                    } ${
                                      part.text.startsWith("scheduled message")
                                        ? "border-accent/50"
                                        : ""
                                    } relative`}
                                  >
                                    {part.text.startsWith(
                                      "scheduled message"
                                    ) && (
                                      <span className="absolute -top-3 -left-2 text-base">
                                        🕒
                                      </span>
                                    )}
                                    <MemoizedMarkdown
                                      id={`${m.id}-${i}`}
                                      content={part.text.replace(
                                        /^scheduled message: /,
                                        ""
                                      )}
                                    />
                                  </Card>
                                  <p
                                    className={`text-xs text-muted-foreground mt-1 ${
                                      isUser ? "text-right" : "text-left"
                                    }`}
                                  >
                                    {formatTime(
                                      m.metadata?.createdAt
                                        ? new Date(m.metadata.createdAt)
                                        : new Date()
                                    )}
                                  </p>
                                </div>
                              );
                            }

                            if (isToolUIPart(part)) {
                              const toolCallId = part.toolCallId;
                              const toolName = part.type.replace("tool-", "");
                              const needsConfirmation =
                                toolsRequiringConfirmation.includes(
                                  toolName as keyof typeof tools
                                );

                              // Skip rendering the card in debug mode
                              if (showDebug) return null;

                              return (
                                <ToolInvocationCard
                                  // biome-ignore lint/suspicious/noArrayIndexKey: using index is safe here as the array is static
                                  key={`${toolCallId}-${i}`}
                                  toolUIPart={part}
                                  toolCallId={toolCallId}
                                  needsConfirmation={needsConfirmation}
                                  onSubmit={({ toolCallId, result }) => {
                                    addToolResult({
                                      tool: part.type.replace("tool-", ""),
                                      toolCallId,
                                      output: result
                                    });
                                  }}
                                  addToolResult={(toolCallId, result) => {
                                    addToolResult({
                                      tool: part.type.replace("tool-", ""),
                                      toolCallId,
                                      output: result
                                    });
                                  }}
                                />
                              );
                            }
                            return null;
                          })}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>

          {/* Input Area */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleAgentSubmit(e, {
                annotations: {
                  hello: "world"
                }
              });
              setTextareaHeight("auto"); // Reset height after submission
            }}
            className="p-3 bg-neutral-50 border-t border-neutral-300 dark:border-neutral-800 dark:bg-neutral-900 flex-shrink-0"
          >
            <div className="flex items-center gap-2">
              <div className="flex-1 relative">
                <Textarea
                  disabled={pendingToolCallConfirmation}
                  placeholder={
                    pendingToolCallConfirmation
                      ? "Please respond to the tool confirmation above..."
                      : "Send a message..."
                  }
                  className="flex w-full border border-neutral-200 dark:border-neutral-700 px-3 py-2  ring-offset-background placeholder:text-neutral-500 dark:placeholder:text-neutral-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-300 dark:focus-visible:ring-neutral-700 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-neutral-900 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm overflow-hidden resize-none rounded-2xl !text-base pb-10 dark:bg-neutral-900"
                  value={agentInput}
                  onChange={(e) => {
                    handleAgentInputChange(e);
                    // Auto-resize the textarea
                  }}
                  onKeyDown={(e) => {
                    if (
                      e.key === "Enter" &&
                      !e.shiftKey &&
                      !e.nativeEvent.isComposing
                    ) {
                      e.preventDefault();
                      handleAgentSubmit(e as unknown as React.FormEvent);
                      setTextareaHeight("auto"); // Reset height on Enter submission
                    }
                  }}
                  rows={2}
                  style={{ height: textareaHeight }}
                />
                <div className="absolute bottom-0 right-0 p-2 w-fit flex flex-row justify-end">
                  {status === "submitted" || status === "streaming" ? (
                    <button
                      type="button"
                      onClick={stop}
                      className="inline-flex items-center cursor-pointer justify-center gap-2 whitespace-nowrap text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 bg-primary text-primary-foreground hover:bg-primary/90 rounded-full p-1.5 h-fit border border-neutral-200 dark:border-neutral-800"
                      aria-label="Stop generation"
                    >
                      <Stop size={16} />
                    </button>
                  ) : (
                    <button
                      type="submit"
                      className="inline-flex items-center cursor-pointer justify-center gap-2 whitespace-nowrap text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 bg-primary text-primary-foreground hover:bg-primary/90 rounded-full p-1.5 border border-neutral-200 dark:border-neutral-800"
                      disabled={
                        pendingToolCallConfirmation || !agentInput.trim()
                      }
                      aria-label="Send message"
                    >
                      <PaperPlaneTilt size={16} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
