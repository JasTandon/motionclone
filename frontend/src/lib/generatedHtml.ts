/**
 * Handling for model-generated preview documents: fence extraction, static lint
 * (used by the server self-heal pass), runtime bridge injection, and a deterministic
 * renderer used when synthesis is unavailable.
 */
import { TrackedLayer } from "@/types/motion";
import type { SpringParams } from "./codegen";

/** Returns the body of the first fenced block tagged with one of `langs` (exact tag match). */
export function extractFencedBlock(text: string, langs: string[]): string | null {
  const re = /```([\w+-]*)[^\n]*\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (langs.includes(m[1].toLowerCase())) return m[2].trim();
  }
  return null;
}

/** HTML document from a model reply: tagged fence, else an unfenced/truncated document. */
export function extractHtmlDocument(text: string): string | null {
  const fenced = extractFencedBlock(text, ["html", "htm"]);
  if (fenced) return fenced;
  const start = text.search(/<!DOCTYPE html|<html/i);
  if (start < 0) return null;
  const end = text.search(/<\/html>/i);
  return end > start ? text.slice(start, end + 7) : text.slice(start).replace(/```[\s\S]*$/, "");
}

export function extractReactCode(text: string): string | null {
  return extractFencedBlock(text, ["tsx", "jsx", "typescript", "ts", "javascript", "js", "react"]);
}

/** Open stroke paths default to black fills; give <svg> roots fill="none" unless set. */
export function sanitizeGeneratedHtml(html: string): string {
  return html.replace(/<svg\b(?![^>]*\bfill=)/gi, '<svg fill="none"');
}

/** Static checks a judge would otherwise discover live: truncation, bad paths, syntax errors. */
export function lintGeneratedHtml(html: string): string[] {
  const issues: string[] = [];
  if (!/<body[\s>]/i.test(html) && !/<html[\s>]/i.test(html)) issues.push("Document has no <html>/<body> element.");
  if (/<html[\s>]/i.test(html) && !/<\/html>\s*$/i.test(html.trim())) issues.push("Document is truncated (missing closing </html>).");
  if (/\bd\s*=\s*["'][^"']*(NaN|undefined|Infinity)/.test(html)) issues.push("An SVG path `d` attribute contains NaN/undefined/Infinity.");
  if (!/requestAnimationFrame|@keyframes|animation\s*:|transition\s*:|\.animate\(/.test(html))
    issues.push("No animation driver found (requestAnimationFrame, CSS animation/transition, or WAAPI).");
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  scripts.forEach((s, i) => {
    const attrs = s[1] || "";
    if (/\bsrc=/.test(attrs) || /type\s*=\s*["'](module|text\/babel|application\/json)/i.test(attrs)) return;
    try {
      // Parse only — never executed on the server.
      new Function(s[2]);
    } catch (err) {
      issues.push(`Inline <script> #${i + 1} has a syntax error: ${String((err as Error).message).slice(0, 160)}`);
    }
  });
  if (/<script[^>]+src=["']https?:\/\/(?!cdn\.tailwindcss\.com|unpkg\.com|cdn\.jsdelivr\.net)/i.test(html))
    issues.push("Loads scripts from an unexpected external host.");
  return issues;
}

export interface PreviewSpringMap {
  primary: SpringParams;
  layers: Record<string, SpringParams>;
}

/**
 * Injects `window.MC_SPRING` (live spring constants) before any page script, plus a bridge
 * that scales oversize content into the viewport and reports runtime errors to the parent.
 */
export function injectPreviewRuntime(html: string, springs: PreviewSpringMap): string {
  const head = `<script>window.MC_SPRING=${JSON.stringify({ ...springs.primary, layers: springs.layers })};</script>`;
  const tail = `<script>
(function(){
  function report(msg){ try{ parent.postMessage({ type: "MC_PREVIEW_ERROR", message: String(msg).slice(0, 400) }, "*"); }catch(e){} }
  window.addEventListener("error", function(e){ report(e.message || "Script error"); });
  window.addEventListener("unhandledrejection", function(e){ report(e.reason && e.reason.message || e.reason); });
  var applied = 1;
  function fit(){
    try{
      var iw = innerWidth, ih = innerHeight, minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      var els = document.body ? document.body.querySelectorAll("*") : [];
      for (var i = 0; i < els.length; i++){
        var r = els[i].getBoundingClientRect();
        if (!r.width || !r.height || (r.width >= iw * 0.98 && r.height >= ih * 0.98)) continue;
        minX = Math.min(minX, r.left); minY = Math.min(minY, r.top); maxX = Math.max(maxX, r.right); maxY = Math.max(maxY, r.bottom);
      }
      if (!isFinite(minX)) return;
      var w = (maxX - minX) / applied, h = (maxY - minY) / applied;
      var s = Math.min(1, (iw - 12) / w, (ih - 12) / h);
      if (s < applied - 0.01){ applied = s; document.body.style.zoom = String(s); }
    }catch(e){}
  }
  window.addEventListener("load", function(){ fit(); setTimeout(fit, 400); setTimeout(fit, 1400); });
  window.addEventListener("message", function(ev){
    if (ev.data === "REPLAY_ANIMATION" || (ev.data && ev.data.type === "REPLAY_ANIMATION")) location.reload();
  });
})();
</script>`;
  let out = html;
  if (/<head[^>]*>/i.test(out)) out = out.replace(/<head[^>]*>/i, (m) => `${m}${head}`);
  else out = head + out;
  out = /<\/body>/i.test(out) ? out.replace(/<\/body>/i, `${tail}</body>`) : out + tail;
  return out;
}

/**
 * Deterministic clone: replays every measured keyframe box with spring easing between
 * keyframes. Used when Muse Spark synthesis is unavailable so the preview never goes blank.
 */
export function buildDeterministicPreviewHtml(layers: TrackedLayer[], bgHex: string, durationMs: number): string {
  const data = layers.map((l) => ({
    id: l.id,
    color: l.colorHex,
    track: (l.track ?? []).map((s) => ({ t: s.tMs, b: s.box })),
    k: l.physics.stiffness,
    c: l.physics.damping,
  }));
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%;background:${bgHex};overflow:hidden;font-family:-apple-system,Inter,sans-serif}
#stage{position:absolute;left:50%;top:50%;width:640px;height:400px;transform:translate(-50%,-50%) scale(var(--s,1))}
.l{position:absolute;border-radius:18px;will-change:transform,width,height;box-shadow:0 10px 30px rgba(0,0,0,.25)}
</style></head><body><div id="stage"></div><script>
var DATA=${JSON.stringify(data)},DUR=${Math.max(400, Math.round(durationMs))};
var stage=document.getElementById("stage");
function scaleStage(){stage.style.setProperty("--s",Math.min(1,innerWidth/660,innerHeight/420));}
scaleStage();addEventListener("resize",scaleStage);
function spring(t,k,c){var m=1,w=Math.sqrt(k/m),z=c/(2*Math.sqrt(k*m));if(t<=0)return 0;
 if(z<1){var wd=w*Math.sqrt(1-z*z);return 1-Math.exp(-z*w*t)*(Math.cos(wd*t)+z/Math.sqrt(1-z*z)*Math.sin(wd*t));}
 return 1-(1+w*t)*Math.exp(-w*t);}
var els=DATA.map(function(d){var e=document.createElement("div");e.className="l";e.style.background=d.color;stage.appendChild(e);return e;});
function frame(now){var t=(now-t0)%(DUR+600);
 DATA.forEach(function(d,i){var S=(window.MC_SPRING&&window.MC_SPRING.layers&&window.MC_SPRING.layers[d.id])||d;
  var tr=d.track,e=els[i],a=null,b=null;
  for(var j=0;j<tr.length-1;j++){if(t>=tr[j].t&&t<=tr[j+1].t){a=tr[j];b=tr[j+1];break;}}
  if(!a){a=b=tr[t<(tr[0]||{t:0}).t?0:tr.length-1];}
  if(!a||!a.b){e.style.opacity=0;return;}
  var bb=b&&b.b?b:a,K=S.k||S.stiffness,C=S.c||S.damping,W=Math.sqrt(K),Z=Math.min(1,C/(2*W)),seg=Math.max(1,bb.t-a.t);
  var u=bb===a?1:spring(((t-a.t)/seg)*(4/Math.max(0.05,Z*W)),K,C);
  var x=a.b.x+(bb.b.x-a.b.x)*u,y=a.b.y+(bb.b.y-a.b.y)*u,w=a.b.width+(bb.b.width-a.b.width)*u,h=a.b.height+(bb.b.height-a.b.height)*u;
  e.style.opacity=1;e.style.left=x+"px";e.style.top=y+"px";e.style.width=Math.max(2,w)+"px";e.style.height=Math.max(2,h)+"px";});
 requestAnimationFrame(frame);}
var t0=performance.now();requestAnimationFrame(frame);
</script></body></html>`;
}
