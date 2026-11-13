// @ts-nocheck
import { createClient } from 'npm:@supabase/supabase-js@2.119.0';

const projectUrl = Deno.env.get('SUPABASE_URL') || '';
let serviceKey = '';
try { serviceKey = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}').default || ''; } catch { /* Fail closed below. */ }
if (!serviceKey) serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const invitation = Deno.env.get('SHUANGSHI_INVITE_CODE') || '';
const bucket = 'submission-photos';
const client = createClient(projectUrl, serviceKey, {auth:{persistSession:false,autoRefreshToken:false}});
const allowedOrigins = new Set(['https://s1mons1ck.github.io','http://127.0.0.1:49371','http://localhost:49371']);
const themes = new Set(['people','animals','plants','architecture','sky']);
const periods = new Set(['morning','day','dusk','night']);
const places = new Set(['canteen','staff','basketball','gym','pool','volleyball','west','library','laboratory','grade-one','circular','auxiliary','grade-three','grade-two','east-field','lake','art','admin','south-gate','pickleball','mengfei','campus-roads','other']);
const maxFileBytes = 50 * 1024 * 1024;
const maxRequestBytes = maxFileBytes + 512 * 1024;

function cors(req) {
  const origin = req.headers.get('origin');
  return origin && allowedOrigins.has(origin) ? {'Access-Control-Allow-Origin':origin,'Vary':'Origin','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-shuangshi-invite','Access-Control-Allow-Methods':'GET, POST, OPTIONS'} : {};
}
function json(req, status, body) { return new Response(JSON.stringify(body),{status,headers:{...cors(req),'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}}); }
function fail(req, status, message) { return json(req,status,{error:message}); }
function text(input, key, max, required = false) {
  const value = typeof input[key] === 'string' ? input[key].trim() : '';
  if ((required && !value) || [...value].length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new Error('请检查填写内容。');
  return value;
}
function fields(input) {
  const title = text(input,'title',40,true), author = text(input,'author',24,true);
  const cohort = text(input,'cohort',4), theme = text(input,'theme',20,true), period = text(input,'period',20,true);
  const mapPlace = text(input,'mapPlace',40), placeDetail = text(input,'placeDetail',60), story = text(input,'story',240);
  if ((cohort && !/^[0-9]{4}$/.test(cohort)) || !themes.has(theme) || !periods.has(period) || (mapPlace && !places.has(mapPlace))) throw new Error('请检查届别、主题、地点和时段。');
  return {title,author,cohort:cohort || null,theme,period,map_place:mapPlace || null,place_detail:mapPlace === 'other' ? placeDetail || null : null,story};
}
async function invitationMatches(candidate) {
  if (!invitation || invitation.length < 16 || typeof candidate !== 'string' || candidate.length > 256) return false;
  const encode = new TextEncoder();
  const [a,b] = await Promise.all([crypto.subtle.digest('SHA-256',encode.encode(candidate)),crypto.subtle.digest('SHA-256',encode.encode(invitation))]);
  const aa = new Uint8Array(a), bb = new Uint8Array(b); let difference = 0;
  for (let i = 0; i < aa.length; i++) difference |= aa[i] ^ bb[i];
  return difference === 0;
}
async function readBounded(req, max) {
  const declared = Number(req.headers.get('content-length'));
  if (declared && declared > max) throw new Error('图片超过测试阶段允许的大小。');
  if (!req.body) throw new Error('没有收到投稿内容。');
  const reader = req.body.getReader(), chunks = []; let size = 0;
  while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > max) { await reader.cancel(); throw new Error('图片超过测试阶段允许的大小。'); } chunks.push(part.value); }
  const all = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { all.set(chunk,offset); offset += chunk.byteLength; } return all;
}
function imageType(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && [137,80,78,71,13,10,26,10].every((b,i)=>bytes[i]===b)) return 'image/png';
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0,4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8,12)) === 'WEBP') return 'image/webp';
  return '';
}
async function isAdmin(req) {
  const auth = req.headers.get('authorization') || '';
  if (!auth.startsWith('Bearer ')) return false;
  const {data,error} = await client.auth.getUser(auth.slice(7));
  if (error || !data?.user?.id) return false;
  const admin = await client.from('site_admins').select('user_id').eq('user_id',data.user.id).maybeSingle();
  return !admin.error && !!admin.data;
}
function publicItem(row) {
  return {id:row.id,title:row.title,author:row.author,cohort:row.cohort,theme:row.theme,period:row.period,mapPlace:row.map_place,placeDetail:row.place_detail,story:row.story,createdAt:row.created_at};
}
async function handler(req) {
  const action = new URL(req.url).searchParams.get('action') || 'public';
  if (req.method === 'OPTIONS') return new Response(null,{status:204,headers:cors(req)});
  if (!projectUrl || !serviceKey) return fail(req,503,'投稿服务暂未配置。');
  if (action === 'public' && req.method === 'GET') {
    const {data,error} = await client.from('submissions').select('id,title,author,cohort,theme,period,map_place,place_detail,story,created_at').eq('status','approved').order('created_at',{ascending:false}).limit(200);
    if (error) return fail(req,500,'暂时无法读取作品。');
    return json(req,200,{items:(data || []).map(publicItem)});
  }
  if (action === 'image' && req.method === 'GET') {
    const id = new URL(req.url).searchParams.get('id') || '';
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) return fail(req,404,'找不到图片。');
    const {data:row,error} = await client.from('submissions').select('object_path,content_type').eq('id',id).eq('status','approved').maybeSingle();
    if (error || !row) return fail(req,404,'找不到图片。');
    const result = await client.storage.from(bucket).download(row.object_path);
    if (result.error || !result.data) return fail(req,404,'找不到图片。');
    return new Response(result.data,{headers:{...cors(req),'Content-Type':row.content_type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
  }
  if (action === 'check-invite' && req.method === 'POST') {
    if (!await invitationMatches(req.headers.get('x-shuangshi-invite'))) return fail(req,403,'邀请码不正确或当前未开放投稿。');
    return json(req,200,{ok:true});
  }
  if (action === 'submit' && req.method === 'POST') {
    if (!req.headers.get('content-type')?.toLowerCase().startsWith('multipart/form-data;')) return fail(req,400,'投稿格式不正确。');
    if (!await invitationMatches(req.headers.get('x-shuangshi-invite'))) return fail(req,403,'邀请码不正确或当前未开放投稿。');
    const {data:reserved,error:quotaError} = await client.rpc('reserve_submission_slot');
    if (quotaError) return fail(req,503,'投稿服务暂时不可用，请稍后再试。');
    if (!reserved) return fail(req,429,'今天的测试投稿已满，请稍后再试。');
    let form;
    try { const bytes = await readBounded(req,maxRequestBytes); form = await new Request(req.url,{method:'POST',headers:{'Content-Type':req.headers.get('content-type')},body:bytes}).formData(); }
    catch (error) { return fail(req,400,error.message || '投稿内容无法读取。'); }
    if (form.get('consent') !== 'on') return fail(req,400,'请确认有权提交并同意审核通过后公开。');
    let metadata;
    try { metadata = fields(Object.fromEntries(form.entries())); }
    catch (error) { return fail(req,400,error.message); }
    const image = form.get('image');
    if (!(image instanceof File) || !image.size || image.size > maxFileBytes) return fail(req,400,'请选择一张不超过 50 MB 的照片。');
    const bytes = new Uint8Array(await image.arrayBuffer()); const type = imageType(bytes);
    if (!type) return fail(req,400,'请选择 JPG、PNG 或 WebP 照片。');
    const id = crypto.randomUUID(), path = `${id}.${type === 'image/jpeg' ? 'jpg' : type === 'image/png' ? 'png' : 'webp'}`;
    const upload = await client.storage.from(bucket).upload(path,bytes,{contentType:type,upsert:false});
    if (upload.error) return fail(req,500,'照片保存失败，请稍后重试。');
    const saved = await client.from('submissions').insert({id,...metadata,object_path:path,content_type:type});
    if (saved.error) { await client.storage.from(bucket).remove([path]); return fail(req,500,'投稿保存失败，请稍后重试。'); }
    return json(req,201,{message:'投稿已收到，等待管理员审核。'});
  }
  if (action.startsWith('admin-') || action === 'review') {
    if (!await isAdmin(req)) return fail(req,403,'没有管理员权限。');
    if (action === 'admin-check' && req.method === 'GET') return json(req,200,{ok:true});
    if (['admin-pending','admin-approved','admin-rejected'].includes(action) && req.method === 'GET') {
      const {data,error} = await client.from('submissions').select('*').eq('status',action.slice(6)).order('created_at',{ascending:false}).limit(200);
      if (error) return fail(req,500,'暂时无法读取投稿。');
      const items = await Promise.all((data || []).map(async row=>{const signed = await client.storage.from(bucket).createSignedUrl(row.object_path,300); return {...publicItem(row),status:row.status,previewUrl:signed.data?.signedUrl || ''};}));
      return json(req,200,{items});
    }
    if (action === 'review' && req.method === 'POST') {
      let input; try { input = JSON.parse(new TextDecoder().decode(await readBounded(req,8192))); } catch { return fail(req,400,'提交内容无法读取。'); }
      if (!/^[0-9a-f-]{36}$/i.test(input.id || '') || !['pending','approved','rejected'].includes(input.status)) return fail(req,400,'无效的审核操作。');
      let metadata; try { metadata = fields(input); } catch (error) { return fail(req,400,error.message); }
      const {data,error} = await client.from('submissions').update({...metadata,status:input.status,reviewed_at:new Date().toISOString()}).eq('id',input.id).select('id').maybeSingle();
      if (error || !data) return fail(req,500,'保存失败，请稍后重试。');
      return json(req,200,{ok:true});
    }
  }
  return fail(req,404,'没有找到该操作。');
}
Deno.serve(async req=>{try{return await handler(req)}catch(error){console.error('Submission service error',error?.name || 'Error');return fail(req,500,'服务暂时不可用，请稍后再试。')}});
