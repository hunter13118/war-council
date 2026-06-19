/**
 * Ship cost telemetry — local vs cloud call tracking.
 */

const CLOUD_TOOLS = new Set(["consult_cloud", "apple_strategic_plan", "strategic_plan"]);

export class ShipCostTracker {
  constructor() {
    this.localCalls = 0;
    this.cloudCalls = 0;
    this.totalMs = 0;
    this.byTool = {};
  }

  /**
   * @param {string} tool
   * @param {string} _text
   * @param {number} ms
   */
  record(tool, _text, ms) {
    this.totalMs += ms;
    this.byTool[tool] = (this.byTool[tool] || 0) + 1;
    if (CLOUD_TOOLS.has(tool) || /CLOUD|gemini|groq/i.test(_text?.slice(0, 80) || "")) {
      this.cloudCalls++;
    } else {
      this.localCalls++;
    }
  }

  summary() {
    return {
      localCalls: this.localCalls,
      cloudCalls: this.cloudCalls,
      totalMs: this.totalMs,
      localVsCloud: `${this.localCalls} local / ${this.cloudCalls} cloud`,
      byTool: { ...this.byTool },
    };
  }
}

/**
 * @param {object} opts
 */
export function recordShipCostSummary(opts) {
  return opts.summary || {};
}
