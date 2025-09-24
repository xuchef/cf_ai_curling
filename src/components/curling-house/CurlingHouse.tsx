import type React from "react";
import {
  ArrowClockwiseIcon,
  ArrowCounterClockwiseIcon,
  HammerIcon
} from "@phosphor-icons/react";

interface Stone {
  color: "red" | "yellow";
  x: number;
  y: number;
}

interface CurlingHouseProps {
  stones?: Stone[];
  shotInfo?: {
    shot_id?: number;
    shot_number?: number;
    shot_color?: string;
    shot_team?: string;
    player_name?: string;
    shot_type?: string;
    turn?: string;
    percent_score?: number;
    end_number?: number;
    color_hammer?: string;
  };
  onShotQuery?: (shotId: number) => void;
}

const ftToPx = (ft: number) => ft * 20;

export const CurlingHouse: React.FC<CurlingHouseProps> = ({
  stones = [],
  shotInfo,
  onShotQuery: _onShotQuery
}) => {
  // Curling ice: 27ft x 15ft
  1380 / 764;
  848 / 1588;

  // Coordinate system matching pdf_parsing_functions.py exactly:
  // - Origin (0,0) is at the button center
  // - X: negative = left, positive = right
  // - Y: negative = behind tee line (toward hack), positive = in front (toward back boards)
  // - Units are in pixels from 300x600 original images
  const svgWidth = ftToPx(15);
  const svgHeight = ftToPx(27);

  // Position the button center in our SVG - using same proportions as original 300x600
  const buttonCenterX = svgWidth / 2;
  const buttonCenterY = ftToPx(21);

  const convertCoords = (x: number, y: number) => {
    // Apply the exact same coordinate transformation as the Python code:
    // x = pixel_x - 149, y = 439 - pixel_y
    // We reverse this: pixel_x = x + 149, pixel_y = 439 - y
    // Then scale to our SVG dimensions
    return {
      x: buttonCenterX + x,
      y: buttonCenterY - y // Note: y is already flipped in the Python coordinate system
    };
  };

  // Curling house dimensions in the coordinate system (scaled appropriately)
  // These need to be proportional to the actual house in the 300x600 pixel images
  const buttonRadius = ftToPx(0.5);
  const fourFootRadius = ftToPx(2); // 4-foot circle
  const eightFootRadius = ftToPx(4); // 8-foot circle
  const twelveFootRadius = ftToPx(6); // 12-foot circle

  // Line positions relative to button center (Y=0)
  // Positive Y is toward back boards, negative Y is toward hack

  return (
    <div className="font-mono">
      {shotInfo && (
        <div className="flex items-center gap-2 mb-2">
          <h3 className="font-bold">Shot #{shotInfo?.shot_number}</h3>
          <h2 className="ml-auto">End {shotInfo?.end_number}</h2>
          <div
            className={`${
              shotInfo?.color_hammer === "red" ? "bg-[#ff6464]" : "bg-[#FFFF05]"
            } rounded-full p-0.5 flex items-center justify-center border border-black`}
          >
            <HammerIcon
              size={14}
              color={shotInfo?.color_hammer === "red" ? "black" : "black"}
              weight="duotone"
            />
          </div>
        </div>
      )}

      <svg
        width={svgWidth}
        height={svgHeight}
        className="outline outline-[#00000080] bg-white"
        aria-label="Curling house with stone positions"
      >
        <title>Curling house with stone positions</title>
        {/* Ice surface background */}
        <rect width={svgWidth} height={svgHeight} fill="#f0f8ff" />

        {/* 12-foot circle */}
        <circle
          cx={buttonCenterX}
          cy={buttonCenterY}
          r={twelveFootRadius}
          fill="#D58FFF"
          stroke="black"
          strokeWidth="1"
        />

        {/* 8-foot circle */}
        <circle
          cx={buttonCenterX}
          cy={buttonCenterY}
          r={eightFootRadius}
          fill="white"
          stroke="black"
          strokeWidth="1"
        />

        {/* 4-foot circle */}
        <circle
          cx={buttonCenterX}
          cy={buttonCenterY}
          r={fourFootRadius}
          fill="#FED2BC"
          stroke="black"
          strokeWidth="1"
        />

        {/* Button */}
        <circle
          cx={buttonCenterX}
          cy={buttonCenterY}
          r={buttonRadius}
          fill="white"
          stroke="black"
          strokeWidth="1"
        />

        {/* Center line */}
        <line
          x1={buttonCenterX}
          y1={0}
          x2={buttonCenterX}
          y2={svgHeight}
          stroke="#00000080"
          strokeWidth="1"
        />

        {/* Tee line (horizontal through button) */}
        <line
          x1={0}
          y1={buttonCenterY}
          x2={svgWidth}
          y2={buttonCenterY}
          stroke="#00000080"
          strokeWidth="1"
        />

        {/* Stones */}
        {stones.map((stone) => {
          const coords = convertCoords(stone.x, stone.y);
          const stoneRadius = ftToPx(11 / 12 / 2);

          return (
            <circle
              key={`${stone.color}-${stone.x}-${stone.y}`}
              cx={coords.x}
              cy={coords.y}
              r={stoneRadius}
              fill={stone.color === "red" ? "#ff6464" : "#FFFF05"}
              stroke="#000"
              strokeWidth="1"
            />
          );
        })}
      </svg>

      {shotInfo && (
        <div className="mt-2 text-md">
          <p className="text-lg">
            {shotInfo.shot_team}: {shotInfo.player_name}
          </p>
          <div className="flex items-center gap-2">
            <span>{shotInfo.shot_type}</span>
            <span className="flex items-center ml-auto">
              {shotInfo.turn === "clockwise" && (
                <ArrowClockwiseIcon size={16} />
              )}
              {shotInfo.turn === "counterclockwise" && (
                <ArrowCounterClockwiseIcon size={16} />
              )}
              {shotInfo.turn &&
                shotInfo.turn !== "clockwise" &&
                shotInfo.turn !== "counterclockwise" &&
                shotInfo.turn}
            </span>
            <span>{shotInfo.percent_score}%</span>
          </div>
        </div>
      )}
    </div>
  );
};
