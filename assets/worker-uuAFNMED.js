const e=self,t=t=>e.postMessage(t);let n=null,r,i;const a=new Promise((e,t)=>{r=e,i=t});a.catch(()=>{});let o=null,s=null;function c(e,t){let n=e instanceof Error?e.message:String(e);if(e?.constructor?.name===`PythonError`||/Traceback \(most recent call last\)/.test(n)){let e=n.trim().split(`
`).filter(Boolean);return{kind:`python`,message:e[e.length-1]??n,traceback:n}}return{kind:t,message:n}}async function l(e){let a=performance.now(),l={},u=(e,n,r={})=>t({type:`status`,status:{state:`loading`,stage:n,step:e,steps:3,elapsedMs:performance.now()-a,timings:{...l},...r}});try{u(0,`Downloading Python runtime`),n=await(await import(
/* @vite-ignore */
`${e.pyodideBase}pyodide.mjs`)).loadPyodide({indexURL:e.pyodideBase,stdout:e=>console.log(`[py]`,e),stderr:e=>console.warn(`[py]`,e)}),l.pyodide=performance.now()-a,u(1,`Loading ${e.packages.join(` + `)}`);let i=performance.now();await n.loadPackage(e.packages,{messageCallback:()=>{},errorCallback:e=>console.warn(e)}),l.packages=performance.now()-i,u(2,`Installing Solaris models`);let o=performance.now(),c=await fetch(new URL(e.manifestPath,e.rootUrl),{cache:`no-cache`});if(!c.ok)throw Error(`Could not load ${e.manifestPath} (HTTP ${c.status}). Run "npm run sync".`);let d=await c.json(),f=`/home/pyodide`,p={},m=``;for(let[t,{files:r}]of Object.entries(d.packages)){let i=await Promise.all(r.map(async n=>{let r=new URL(`py/${t}/${n.path}${n.hash?`?v=${n.hash}`:``}`,e.rootUrl),i=await fetch(r);if(!i.ok)throw Error(`Could not fetch ${r.pathname} (HTTP ${i.status})`);return[n.path,await i.text()]}));for(let[e,r]of i){let i=`${f}/${t}/${e}`;n.FS.mkdirTree(i.slice(0,i.lastIndexOf(`/`))),n.FS.writeFile(i,r),e.endsWith(`.py`)&&(m+=`\n${r}`)}p[t]=r.length}await n.loadPackagesFromImports(m),n.runPython(`import sys\nif "${f}" not in sys.path: sys.path.insert(0, "${f}")\nimport importlib; importlib.invalidate_caches()`),n.runPython(`
import json, math, importlib, sys

def _sol_sanitize(o):
    if isinstance(o, float):
        return o if math.isfinite(o) else None
    if isinstance(o, dict):
        return {str(k): _sol_sanitize(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_sol_sanitize(v) for v in o]
    try:
        import numpy as _np
        if isinstance(o, _np.ndarray):
            return _sol_sanitize(o.tolist())
        if isinstance(o, _np.generic):
            return _sol_sanitize(o.item())
    except ImportError:
        pass
    return o

def _sol_call(module, fn, args_json):
    mod = importlib.import_module(module)
    f = getattr(mod, fn)
    args = json.loads(args_json)
    res = f(*args) if isinstance(args, list) else f(**args)
    return json.dumps(_sol_sanitize(res), allow_nan=False)

def _sol_try_import(name):
    try:
        importlib.import_module(name)
        return ""
    except BaseException:
        import traceback
        return traceback.format_exc()
`),s=n.globals.get(`_sol_call`);let h=n.globals.get(`_sol_try_import`),g=p.solaris_models?h(`solaris_models.api`):`solaris_models not present in py/manifest.json`;h.destroy?.(),l.install=performance.now()-o,l.total=performance.now()-a,t({type:`status`,status:{state:`ready`,stage:`Ready`,step:3,steps:3,elapsedMs:l.total,timings:l,packages:p,modelsAvailable:!g,modelsError:g||void 0}}),r()}catch(e){o=c(e,`runtime`),t({type:`status`,status:{state:`error`,stage:`Failed to start Python runtime`,step:0,steps:3,elapsedMs:performance.now()-a,error:o,timings:l}}),i(e)}}async function u(e){let n=performance.now();try{await a}catch{t({type:`result`,id:e.id,ok:!1,error:o??{kind:`runtime`,message:`Runtime failed to load`},ms:0});return}try{let r=s(e.module,e.fn,e.argsJson);t({type:`result`,id:e.id,ok:!0,json:r,ms:performance.now()-n})}catch(r){t({type:`result`,id:e.id,ok:!1,error:c(r,`python`),ms:performance.now()-n})}}e.onmessage=e=>{let t=e.data;t.type===`init`?l(t):t.type===`call`&&u(t)};