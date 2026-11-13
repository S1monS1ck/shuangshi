'use strict';
(() => {
  const config = window.SHUANGSHI_BACKEND;
  if (!config?.url || !config?.publishableKey) return;
  const base = config.url.replace(/\/+$/, ''), api = `${base}/functions/v1/submissions`;
  const form = document.querySelector('#draft-form'), status = document.querySelector('#draft-status');
  const imageInput = document.querySelector('#draft-image'), liveFields = document.querySelector('#live-submission-fields');
  const submit = document.querySelector('#draft-submit'), saveDraft = document.querySelector('#save-local-draft');
  const note = document.querySelector('#submit-dialog > .muted');
  const commonHeaders = {'apikey':config.publishableKey};
  liveFields.hidden = false; saveDraft.hidden = false;
  form.elements.invite.required = true; form.elements.consent.required = true; form.elements.theme.required = true; imageInput.required = true;
  submit.innerHTML = '提交审核 <span>↗</span>';
  note.textContent = '输入测试邀请码，照片会先交给管理员审核；审核通过后才会公开。测试期间大家合计每 24 小时最多尝试提交 10 次（包括失败的提交）。';
  form.elements.theme.closest('label').querySelector('.field-hint').textContent = '必选';
  const uploadHint = document.querySelector('.upload-box span');
  uploadHint.textContent = 'JPG / PNG / WebP · 保留原图 · 最大 50 MB';
  function save() {
    const data = Object.fromEntries(new FormData(form)); delete data.invite; delete data.consent;
    try { localStorage.setItem('shuangshi-draft',JSON.stringify(data)); status.textContent = '文字草稿已保存在此浏览器，照片和邀请码不会保存。'; }
    catch { status.textContent = '浏览器未允许保存，文字仍保留在当前表单中。'; }
  }
  saveDraft.onclick = save;
  form.onsubmit = async event => {
    event.preventDefault(); const image = imageInput.files[0];
    if (!image || image.size > 50 * 1024 * 1024) { status.textContent = '请选择一张不超过 50 MB 的照片。'; return; }
    submit.disabled = true; status.textContent = '正在上传原图并提交审核，请稍候…';
    try {
      const data = new FormData(form); data.set('image',image); data.delete('invite');
      const response = await fetch(`${api}?action=submit`,{method:'POST',headers:{...commonHeaders,'x-shuangshi-invite':form.elements.invite.value},body:data});
      let result = {}; try { result = await response.json(); } catch {}
      if (!response.ok) throw new Error(result.error || '提交失败，请稍后再试。');
      form.elements.invite.value = ''; imageInput.value = ''; document.querySelector('#draft-preview').hidden = true;
      status.textContent = result.message || '投稿已收到，等待管理员审核。';
    } catch (error) { status.textContent = error.message || '提交失败，请检查网络后重试。'; }
    finally { submit.disabled = false; }
  };
  async function loadPublished() {
    try {
      const response = await fetch(`${api}?action=public`,{headers:commonHeaders}); if (!response.ok) return;
      const data = await response.json(); if (!Array.isArray(data.items)) return;
      const existing = new Set(photos.map(p=>p.id));
      for (const item of data.items) {
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(item.id || '') || existing.has(item.id)) continue;
        const period = periods.find(p=>p.id===item.period), theme = themes.find(t=>t.id===item.theme);
        if (!period || !theme) continue;
        const mapPlace = window.MAP_DATA?.places.find(p=>p.id===item.mapPlace);
        const label = mapPlace?.name || (item.mapPlace === 'other' && item.placeDetail ? item.placeDetail : '地点待确认');
        photos.push({id:item.id,title:String(item.title||''),author:String(item.author||''),story:String(item.story||''),period:period.id,theme:theme.id,glyph:period.name,color:period.color,fg:period.fg,mapPlace:mapPlace?.id || null,place:`枋湖校区 · ${label}`,src:`${api}?action=image&id=${encodeURIComponent(item.id)}`,width:1920,height:1280,num:String(photos.length+1).padStart(2,'0')});
        existing.add(item.id);
      }
      const open = document.querySelector('dialog[open]'); if (open) open.addEventListener('close',()=>render(),{once:true}); else render();
    } catch { /* Existing photos remain available if the contribution service is offline. */ }
  }
  loadPublished();
})();
