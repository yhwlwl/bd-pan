const {test}=require('node:test');
const assert=require('node:assert/strict');
const ts=require('typescript');
const fs=require('node:fs');
const path=require('node:path');
const Module=require('node:module');

function loadProxy({banned=false, fail=false}={}) {
  const filename=path.resolve(__dirname,'../src/proxy.ts');
  const mod=new Module(filename,module);
  let calls=0;
  let audits=0;
  const stubs={
    'next/server':{NextResponse:class extends Response {
      static next(){return new Response(null,{headers:{'x-test-next':'yes'}});}
      static redirect(url,init){return new Response(null,{...init,headers:{...init.headers,location:url}});}
    }},
    './lib/deny-tracker':{
      getRequestContext:()=>({ip:'192.0.2.1'}),
      checkEntityBanned:async()=>{calls++;if(fail)throw Error('unavailable');return {banned};},
      denyAndLog:async(request)=>{audits++;return request.method==='GET'&&request.headers.get('sec-fetch-mode')==='navigate'
        ? new Response(null,{status:303,headers:{location:'https://deny.tantantan.tech/#business-ban'}})
        : Response.json({blocked:true},{status:403});}
    },
    './lib/fingerprint':{hashDeviceCode:()=>null},
    './app/api/_auth':{verifyToken:()=>null},
    './lib/business-deny-client':{BUSINESS_DENY_URL:'https://deny.tantantan.tech/#business-ban'},
  };
  mod.require=id=>{if(!(id in stubs))throw Error(id);return stubs[id];};
  mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
  }).outputText,filename);
  return {...mod.exports,counts:()=>({calls,audits})};
}
function request(pathname,method='GET',headers={}) {
  const req=new Request('https://example.test'+pathname,{method,headers});
  req.nextUrl=new URL(req.url);
  return req;
}

test('all page routes including mg and unknown paths redirect on a confirmed ban',async()=>{
  const {proxy,counts}=loadProxy({banned:true});
  for(const p of ['/','/mg','/mg/anything','/future-page','/unknown/path','/pan/mg']){
    const response=await proxy(request(p));
    assert.equal(response.status,303);
    assert.equal(response.headers.get('location'),'https://deny.tantantan.tech/#business-ban');
    assert.equal(response.headers.get('cache-control'),'no-store');
  }
  assert.deepEqual(counts(),{calls:6,audits:6});
});
test('API ban stays 403 JSON for fetch and redirects top-level navigation',async()=>{
  const {proxy}=loadProxy({banned:true});
  const response=await proxy(request('/api/users','POST'));
  assert.equal(response.status,403);
  assert.equal((await response.json()).blocked,true);
  const navigation=await proxy(request('/api/alist-download','GET',{'sec-fetch-mode':'navigate'}));
  assert.equal(navigation.status,303);
});
test('ordinary traffic and service errors continue to existing route-level checks',async()=>{
  for(const options of [{},{fail:true}]){
    const {proxy,counts}=loadProxy(options);
    const response=await proxy(request('/mg'));
    assert.equal(response.headers.get('x-test-next'),'yes');
    assert.equal(counts().audits,0);
  }
});
test('OPTIONS preserves existing API CORS without redirect',async()=>{
  const {proxy,counts}=loadProxy({banned:true});
  const response=await proxy(request('/api/users','OPTIONS'));
  assert.equal(response.status,204);
  assert.equal(counts().calls,0);
});
