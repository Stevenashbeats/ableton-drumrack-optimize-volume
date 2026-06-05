import {
  initialize,
  DrumRack,
  Simpler,
  type DeviceParameter,
  type ActivationContext,
  type ExtensionContext,
  type Handle,
} from "@ableton-extensions/sdk";

type Ctx = ExtensionContext<"1.0.0">;

/** Simpler Volume is in dB → 0 dB = value 0. Fall back to the param default
 *  (Simpler's default Volume is 0 dB) if the range isn't a dB range. */
function volumeTarget(p: DeviceParameter<"1.0.0">): number {
  return p.min < 0 && p.max >= 0 ? 0 : p.defaultValue;
}

interface Report {
  pads: number;
  simplers: number;
  volumeSet: number;
  velSet: number;
  firstParams: string[];
}

async function optimize(ctx: Ctx, handle: Handle): Promise<Report> {
  const rack = ctx.getObjectFromHandle(handle, DrumRack);
  const report: Report = { pads: 0, simplers: 0, volumeSet: 0, velSet: 0, firstParams: [] };

  const all = ctx.withinTransaction(() => {
    const promises: Promise<void>[] = [];
    for (const chain of rack.chains) {
      report.pads++;
      const simpler = chain.devices.find((d): d is Simpler<"1.0.0"> => d instanceof Simpler);
      if (!simpler) continue;
      report.simplers++;

      if (report.firstParams.length === 0) {
        report.firstParams = simpler.parameters.map(
          (p) => `${p.name} [${p.min}…${p.max}] def=${p.defaultValue}`,
        );
      }

      for (const p of simpler.parameters) {
        const n = p.name.trim().toLowerCase();
        if (n === "volume") {
          promises.push(p.setValue(volumeTarget(p)));
          report.volumeSet++;
        } else if (n.includes("vol") && n.includes("vel")) {
          // "Vol < Vel" — 0% is the bottom of its range.
          promises.push(p.setValue(p.min));
          report.velSet++;
        }
      }
    }
    return Promise.all(promises);
  });

  await all;
  return report;
}

function resultHtml(r: Report): string {
  const ok = r.simplers > 0;
  const body = ok
    ? `<h1 class="ok">✅ Optimized</h1>
       <div class="row"><b>Pads:</b> ${r.pads} &nbsp; <b>Simplers:</b> ${r.simplers}</div>
       <div class="row"><b>Volume → 0 dB:</b> ${r.volumeSet} &nbsp; <b>Vol&lt;Vel → 0%:</b> ${r.velSet}</div>`
    : `<h1 class="err">⚠ No Simplers found</h1>
       <div class="row">No Simpler devices on the pads (e.g. Sampler / Drum Cell aren't exposed by the SDK).</div>`;
  const dbg = r.firstParams.length
    ? `<details><summary>First Simpler's parameters (debug)</summary><pre>${r.firstParams.join("\n").replace(/</g, "&lt;")}</pre></details>`
    : "";
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
    html{background:hsl(0,0%,21%);color:hsl(0,0%,75%);font-family:system-ui,sans-serif;font-size:12px;height:100%}
    body{margin:0;height:100%;display:flex;flex-direction:column;gap:.5em;padding:1.2em;justify-content:center}
    h1{font-size:1.3rem}.ok{color:hsl(140,50%,60%)}.err{color:hsl(40,90%,62%)}.row{line-height:1.6}
    details{color:hsl(0,0%,55%);margin-top:.3em}pre{white-space:pre-wrap;font-size:10.5px;color:hsl(31,100%,72%);max-height:120px;overflow:auto}
    button{font:inherit;align-self:flex-end;margin-top:.4em;background:hsl(31,100%,67%);color:hsl(0,0%,7%);border:none;height:26px;padding:0 1.4em;border-radius:1em;cursor:pointer}
    </style></head><body>${body}${dbg}
    <button id="c">OK</button>
    <script>function x(){const m={method:"close_and_send",params:["ok"]};
      if(window.webkit&&window.webkit.messageHandlers&&window.webkit.messageHandlers.live)window.webkit.messageHandlers.live.postMessage(m);
      else if(window.chrome&&window.chrome.webview)window.chrome.webview.postMessage(m);}
      document.getElementById("c").addEventListener("click",x);
      document.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key==="Escape")x();});<\/script></body></html>`;
}

export function activate(activation: ActivationContext) {
  const ctx = initialize(activation, "1.0.0");

  ctx.commands.registerCommand("drumOptimize.run", (arg: unknown) =>
    void (async (handle: Handle) => {
      const report = await optimize(ctx, handle);
      console.log("[Drum Optimize]", JSON.stringify(report));
      await ctx.ui.showModalDialog(
        `data:text/html,${encodeURIComponent(resultHtml(report))}`,
        420,
        300,
      );
    })(arg as Handle).catch((e) => console.error("[Drum Optimize]", e)),
  );

  ctx.ui.registerContextMenuAction(
    "DrumRack",
    "Optimize Volume (0 dB · Vol<Vel 0%)",
    "drumOptimize.run",
  );
}
