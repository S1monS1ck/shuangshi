'use strict';
(() => {
  const config = window.SHUANGSHI_BACKEND;
  const $ = selector => document.querySelector(selector);
  const login = $('#login-panel'), review = $('#review-panel');
  const loginStatus = $('#login-status'), reviewStatus = $('#review-status');
  const list = $('#submissions');
  const themes = [['people','人物'],['animals','动物'],['plants','草木'],['architecture','建筑'],['sky','天空']];
  const periods = [['morning','晨 · 晨光'],['day','昼 · 白日'],['dusk','暮 · 日落'],['night','夜 · 灯火']];
  const locations = [['','未指定'], ...(window.MAP_DATA?.places || []).map(p => [p.id,p.name]), ['other','其他地点']];
  let accessToken = '', selectedStatus = 'pending', busy = false;
  const element = (tag, text, className) => { const node = document.createElement(tag); if (text != null) node.textContent = text; if (className) node.className = className; return node; };
  const headers = () => ({'apikey':config.publishableKey, 'Authorization':`Bearer ${accessToken}`});
  async function api(action, options = {}) {
    const response = await fetch(`${config.url}/functions/v1/submissions?action=${encodeURIComponent(action)}`, {...options, headers:{...headers(), ...(options.headers || {})}});
    let result = {}; try { result = await response.json(); } catch {}
    if (!response.ok) { if (response.status === 401 || response.status === 403) throw new Error('登录已失效或该账号没有管理员权限。'); throw new Error(result.error || '操作失败，请稍后重试。'); }
    return result;
  }
  function field(form, title, name, value, options) {
    const label = element('label', title); let input;
    if (options) { input = element('select'); for (const [id, text] of options) input.add(new Option(text,id)); }
    else { input = element(name === 'story' ? 'textarea' : 'input'); if (name === 'story') input.rows = 3; }
    input.name = name; input.value = value || ''; label.append(input); form.append(label);
  }
  function card(item) {
    const article = element('article', null, 'review-card');
    const image = element('img'); image.alt = `投稿照片：${item.title}`; image.src = item.previewUrl; article.append(image);
    const content = element('div'), title = element('h2',item.title), meta = element('p',`投稿时间：${new Date(item.createdAt).toLocaleString('zh-CN')}`, 'review-meta');
    content.append(title,meta);
    const form = element('form', null, 'review-form');
    field(form,'标题','title',item.title); field(form,'署名','author',item.author);
    field(form,'届别（毕业年份）','cohort',item.cohort); field(form,'主题','theme',item.theme,themes);
    field(form,'光的时段','period',item.period,periods); field(form,'拍摄地点','mapPlace',item.mapPlace,locations);
    field(form,'地点补充','placeDetail',item.placeDetail); field(form,'记忆','story',item.story);
    const actions = element('div',null,'review-actions');
    const choices = item.status === 'pending' ? [['approved','审核通过并发布'],['rejected','不通过']] : item.status === 'approved' ? [['approved','保存修改'],['pending','下架并转待审核']] : [['pending','转回待审核']];
    for (const [status, caption] of choices) {
      const button = element('button', caption); button.type = 'submit'; button.value = status; button.name = 'action'; actions.append(button);
    }
    form.append(actions); form.onsubmit = async event => {
      event.preventDefault(); if (busy) return; busy = true; for (const button of actions.children) button.disabled = true; reviewStatus.textContent = '正在保存…';
      try {
        const data = Object.fromEntries(new FormData(form)); data.status = event.submitter?.value; data.id = item.id;
        await api('review',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
        reviewStatus.textContent = '已保存。'; await load();
      } catch (error) { reviewStatus.textContent = error.message; }
      finally { busy = false; for (const button of actions.children) button.disabled = false; }
    };
    content.append(form); article.append(content); return article;
  }
  async function load() {
    list.replaceChildren(); reviewStatus.textContent = '正在读取投稿…';
    try { const result = await api(`admin-${selectedStatus}`); for (const item of result.items) list.append(card(item)); reviewStatus.textContent = result.items.length ? `共 ${result.items.length} 条。` : '这里暂时没有投稿。'; }
    catch (error) { reviewStatus.textContent = error.message; }
  }
  $('#login-form').onsubmit = async event => {
    event.preventDefault(); if (!config?.url || !config?.publishableKey) { loginStatus.textContent = '后台服务尚未配置，暂时无法登录。'; return; }
    const form = event.currentTarget, button = form.querySelector('button'); button.disabled = true; loginStatus.textContent = '正在登录…';
    try {
      const response = await fetch(`${config.url}/auth/v1/token?grant_type=password`, {method:'POST',headers:{'Content-Type':'application/json','apikey':config.publishableKey},body:JSON.stringify({email:form.elements.email.value.trim(),password:form.elements.password.value})});
      const session = await response.json(); if (!response.ok || !session.access_token) throw new Error('登录失败，请检查邮箱和密码。');
      accessToken = session.access_token; await api('admin-check'); form.elements.password.value = ''; login.hidden = true; review.hidden = false; $('#sign-out').hidden = false; loginStatus.textContent = ''; await load();
    } catch (error) { accessToken = ''; form.elements.password.value = ''; loginStatus.textContent = error.message || '登录失败，请稍后再试。'; }
    finally { button.disabled = false; }
  };
  $('#sign-out').onclick = () => { accessToken = ''; list.replaceChildren(); review.hidden = true; login.hidden = false; $('#sign-out').hidden = true; loginStatus.textContent = '已退出。'; };
  $('#refresh').onclick = load;
  for (const button of document.querySelectorAll('[data-status]')) button.onclick = () => { selectedStatus = button.dataset.status; for (const tab of document.querySelectorAll('[data-status]')) tab.setAttribute('aria-pressed',String(tab === button)); load(); };
})();
