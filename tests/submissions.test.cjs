const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

function setup() {
  const rows = [], objects = new Map(); let handler, reserved = 0;
  class Query {
    constructor(table) { this.table = table; this.filters = []; this.operation = 'select'; this.value = null; }
    select() { return this; } eq(key, value) { this.filters.push([key,value]); return this; }
    order() { return this; } limit(n) { this.n = n; return this; }
    insert(value) { this.operation = 'insert'; this.value = value; return this; }
    update(value) { this.operation = 'update'; this.value = value; return this; }
    results() {
      if (this.table === 'site_admins') return {data:this.filters.some(([k,v])=>k === 'user_id' && v === 'the-admin-id') ? [{user_id:'the-admin-id'}] : [],error:null};
      if (this.operation === 'insert') { rows.push({...this.value,status:'pending',created_at:new Date().toISOString()}); return {data:null,error:null}; }
      let found = rows.filter(r => this.filters.every(([k,v]) => r[k] === v));
      if (this.operation === 'update') found.forEach(r => Object.assign(r,this.value));
      return {data:found.slice(0,this.n || 999),error:null};
    }
    maybeSingle() { const result = this.results(); return Promise.resolve({data:result.data?.[0] || null,error:result.error}); }
    then(resolve,reject) { return Promise.resolve(this.results()).then(resolve,reject); }
  }
  const client = {
    from: name => new Query(name), rpc: async name => ({data:++reserved <= 10,error:null}),
    auth:{getUser:async token=>({data:{user:token === 'valid-admin-token' ? {id:'the-admin-id'} : {id:'another-user'}},error:null})},
    storage:{from:()=>({
      upload:async (path,bytes,options)=>{objects.set(path,{bytes,options});return {error:null}},
      download:async path=>objects.has(path)?{data:new Blob([objects.get(path).bytes]),error:null}:{data:null,error:'missing'},
      remove:async paths=>{paths.forEach(path=>objects.delete(path));return {error:null}},
      createSignedUrl:async path=>({data:{signedUrl:`https://private.example/${path}`},error:null}),
    })},
  };
  const env = {SUPABASE_URL:'https://project.example',SUPABASE_SERVICE_ROLE_KEY:'secret',SHUANGSHI_ADMIN_USER_ID:'the-admin-id',SHUANGSHI_INVITE_CODE:'a-long-test-invitation'};
  const source = fs.readFileSync('supabase/functions/submissions/index.ts','utf8').replace(/^import .*?;\s*$/m,'');
  const context = {createClient:()=>client,Deno:{env:{get:k=>env[k]},serve:fn=>{handler=fn}},crypto:webcrypto,console,URL,Request,Response,Headers,FormData,File,Blob,Uint8Array,TextDecoder,TextEncoder,Set,Date,Number,String,Object,Promise,JSON,Error};
  vm.runInNewContext(source,context);
  const url = action => `https://project.example/functions/v1/submissions?action=${action}`;
  const invoke = (action, options={}) => handler(new Request(url(action),options));
  return {invoke,rows,objects};
}

function post(invite='a-long-test-invitation', content=[0xff,0xd8,0xff,0x01]) {
  const body = new FormData();
  for (const [key,value] of Object.entries({consent:'on',title:'校园的天空',author:'小明',theme:'sky',period:'day',mapPlace:'east-field',cohort:'2024',story:'一束光'})) body.set(key,value);
  body.set('image',new File([new Uint8Array(content)],'image.jpg',{type:'image/jpeg'}));
  return {method:'POST',headers:{'x-shuangshi-invite':invite},body};
}

test('invitation gates submission and photos remain private until administrator approval', async () => {
  const {invoke,rows} = setup();
  assert.equal((await invoke('submit',post('wrong'))).status,403);
  assert.equal(rows.length,0);
  assert.equal((await invoke('submit',post())).status,201);
  assert.equal(rows.length,1); const id = rows[0].id;
  assert.deepEqual((await (await invoke('public')).json()).items,[]);
  assert.equal((await invoke(`image&id=${id}`)).status,404);
  assert.equal((await invoke('admin-check')).status,403);
  assert.equal((await invoke('admin-check',{headers:{Authorization:'Bearer other-token'}})).status,403);
  assert.equal((await invoke('admin-check',{headers:{Authorization:'Bearer valid-admin-token'}})).status,200);
  const review = {id,status:'approved',title:'校园的天空',author:'小明',theme:'sky',period:'day',mapPlace:'east-field',cohort:'2024',story:'一束光'};
  assert.equal((await invoke('review',{method:'POST',headers:{Authorization:'Bearer valid-admin-token','Content-Type':'application/json'},body:JSON.stringify(review)})).status,200);
  assert.equal((await (await invoke('public')).json()).items.length,1);
  const image = await invoke(`image&id=${id}`); assert.equal(image.status,200); assert.equal(image.headers.get('content-type'),'image/jpeg'); assert.equal(image.headers.get('cache-control'),'no-store');
  review.status='pending'; await invoke('review',{method:'POST',headers:{Authorization:'Bearer valid-admin-token','Content-Type':'application/json'},body:JSON.stringify(review)});
  assert.equal((await invoke(`image&id=${id}`)).status,404);
});

test('invalid images, categories, and missing consent cannot be submitted', async () => {
  const {invoke,rows} = setup();
  assert.equal((await invoke('submit',post('a-long-test-invitation',[1,2,3,4]))).status,400);
  const missingConsent = post(); missingConsent.body.delete('consent'); assert.equal((await invoke('submit',missingConsent)).status,400);
  const invalidTheme = post(); invalidTheme.body.set('theme','arbitrary'); assert.equal((await invoke('submit',invalidTheme)).status,400);
  assert.equal(rows.length,0);
});
