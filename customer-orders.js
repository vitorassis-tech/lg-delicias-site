// Private order access and retry-safe checkout. Tokens are kept on this device,
// sent only in Authorization, and removed immediately from shared URL fragments.
(() => {
  'use strict';
  const STORE='lg-customer-orders-v24', h=escapeHtml, fmt=n=>money(n/100);
  $('#drawer').setAttribute('inert','');
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&$('#drawer').classList.contains('open'))close()});
  const labels={new:'Aguardando confirmação',preparing:'Confirmado / em preparo',ready:'Pronto para retirada',completed:'Finalizado',cancelled:'Cancelado'};
  const eventLabels={created:'Pedido recebido',addition_requested:'Solicitação de acréscimo',addition_applied:'Acréscimo efetivado',addition_rejected:'Acréscimo recusado',price_changed:'Preço atualizado',status:'Status atualizado',payment:'Pagamento atualizado',access_issued:'Link privado atualizado'};
  let saved, current=null, busy=false, refreshing=false, syncing=false;
  try{saved=JSON.parse(localStorage.getItem(STORE)||'{}')}catch{saved={}}
  if(!saved||!Array.isArray(saved.orders))saved={orders:[]};
  function persist(){try{localStorage.setItem(STORE,JSON.stringify(saved));return true}catch{return false}}
  const tokenOK=t=>typeof t==='string'&&/^[a-f0-9]{64}$/.test(t);
  saved.orders=saved.orders.filter(x=>tokenOK(x.token));
  const fragment=new URLSearchParams(location.hash.slice(1)).get('pedido');
  if(fragment){history.replaceState(null,'',location.pathname+location.search);if(tokenOK(fragment)){if(!saved.orders.some(x=>x.token===fragment))saved.orders.unshift({token:fragment,code:'Pedido compartilhado'});saved.active=fragment;persist()}}
  if(!tokenOK(saved.active))saved.active=saved.orders[0]?.token||'';
  if(saved.draft&&!tokenOK(saved.draft.token))delete saved.draft;
  const token=()=>saved.draft?.token||saved.active;
  const random=()=>[...crypto.getRandomValues(new Uint8Array(32))].map(x=>x.toString(16).padStart(2,'0')).join('');
  const time=s=>new Date(s.includes('T')?s:s.replace(' ','T')+'Z').toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
  const selection=()=>[...cart].sort((a,b)=>a[0]-b[0]).map(([productId,quantity])=>({productId,quantity}));
  function message(text,error=false){const box=$('#tracking-message');box.textContent=text;box.classList.toggle('error',error)}
  function remember(secret,order){const found=saved.orders.find(x=>x.token===secret);if(found)found.code=order.code;else saved.orders.unshift({token:secret,code:order.code});saved.active=secret;persist();renderPicker()}
  async function request(url,options={}){
    const response=await fetch(url,{cache:'no-store',...options,headers:{'content-type':'application/json',...(token()?{authorization:'Bearer '+token()}:{}),...options.headers}});
    let data;try{data=await response.json()}catch{throw new Error('Não foi possível verificar o resultado. Tente novamente para recuperar o mesmo envio.')}
    if(!response.ok){const e=new Error(data.error||'Não foi possível concluir.');e.data=data;e.status=response.status;throw e}return data;
  }
  function lines(items,extra=false){return '<ul class="addition-items">'+items.map(i=>`<li><span>${i.quantity}× ${h(extra?i.name:i.product_name)}<small>${extra?fmt(i.unitCents):money(i.unit_price)} cada</small></span><strong>${extra?fmt(i.subtotalCents):money(i.subtotal)}</strong></li>`).join('')+'</ul>'}
  function totals(o){return `<dl class="order-amounts"><div><dt>Total do pedido</dt><dd>${fmt(o.total_cents)}</dd></div><div><dt>Pagamento registrado</dt><dd>${fmt(o.paid_amount_cents)}</dd></div><div class="balance"><dt>Saldo pendente</dt><dd>${fmt(o.balance_cents)}</dd></div></dl>`}
  function eventList(o){return `<details class="order-audit"><summary>Histórico do pedido</summary><ol>${o.events.map(e=>`<li><strong>${h(eventLabels[e.kind]||e.kind)}</strong><small>${time(e.created_at)} · ${h(e.actor)}</small>${e.items.length?lines(e.items,true):''}${e.amount_cents?`<p>Valor dos itens: ${fmt(e.amount_cents)}</p>`:''}${e.total_after_cents!==null?`<p>Total: ${fmt(e.total_before_cents)} → ${fmt(e.total_after_cents)}</p>`:''}<p>${h(e.note.replace(/Status: (\w+) → (\w+)\./,(_,a,b)=>`Status: ${labels[a]||a} → ${labels[b]||b}.`))}</p></li>`).join('')}</ol></details>`}
  $('#cardapio').insertAdjacentHTML('beforebegin',`<section class="customer-tracking" id="meus-pedidos"><div class="heading"><div><p class="eyebrow">Seu pedido, sempre por perto</p><h2>Acompanhe seu pedido</h2></div><button class="secondary" id="refresh-tracking" type="button">Atualizar</button></div><label id="order-picker-label">Pedidos salvos neste aparelho<select id="order-picker"></select></label><p id="tracking-message" role="status" aria-live="polite"></p><div id="tracking-content"><p>Após confirmar um pedido, você poderá acompanhá-lo e acrescentar itens por aqui. Para um pedido anterior, use o link privado fornecido pela L&G.</p></div></section><div id="addition-banner" class="addition-banner" hidden><div><strong id="addition-banner-title"></strong><span>Você está selecionando apenas os itens adicionais.</span></div><div class="action-row"><button class="primary" id="review-addition">Revisar acréscimo</button><button class="secondary" id="exit-addition">Voltar ao acompanhamento</button></div></div>`);
  $('.topbar').insertAdjacentHTML('beforeend','<a class="my-orders-link" href="#meus-pedidos">Meus pedidos</a>');
  $('#checkout').insertAdjacentHTML('beforebegin','<section id="addition-checkout" hidden><h3>Revise o acréscimo</h3><div id="addition-review"></div><p id="addition-error" role="status" aria-live="polite"></p><div class="action-row"><button class="primary" id="confirm-addition" type="button">Revisar acréscimo</button><button class="secondary" id="edit-addition" type="button">Escolher mais itens</button></div></section>');
  $('#order-success').insertAdjacentHTML('beforeend','<button class="primary" id="success-addition" type="button">Adicionar itens ao meu pedido</button><button class="secondary" id="success-track" type="button">Acompanhar pedido</button>');
  function renderPicker(){const select=$('#order-picker'),active=saved.active;select.innerHTML=saved.orders.map((o,i)=>`<option value="${i}" ${o.token===active?'selected':''}>${h(o.code)}</option>`).join('');$('#order-picker-label').hidden=!saved.orders.length;select.disabled=!!saved.draft||!!saved.checkoutAttempt||busy}
  function renderTracking(){
    renderPicker();if(!current)return;
    const o=current,canAdd=['new','preparing'].includes(o.status);
    const additions=o.additions.filter(a=>a.state!=='quoted');
    $('#tracking-content').innerHTML=`<article class="tracked-order"><header><div><span class="order-code">${h(o.code)}</span><h3>${h(o.customer_name)}</h3><p>${h(o.customer_sector)} · ${time(o.created_at)}</p></div><span class="tracking-status">${labels[o.status]||h(o.status)}</span></header>${lines(o.items)}${totals(o)}${o.note?`<p class="order-note"><strong>Observação:</strong> ${h(o.note)}</p>`:''}${additions.map(a=>`<section class="addition-box state-${a.state}"><h4>${{pending:'Acréscimo aguardando aprovação',applied:'Acréscimo efetivado',rejected:'Acréscimo recusado',price_changed:'Novo preço: seu aceite é necessário'}[a.state]}</h4>${lines(a.items,true)}<p><strong>Valor adicional: ${fmt(a.amount_cents)}</strong></p>${a.state==='pending'?'<p>O total acima permanece confirmado. A disponibilidade dos adicionais depende da aprovação da L&G; o estoque ainda não está reservado.</p>':''}${a.reason?`<p>${h(a.reason)}</p>`:''}${a.state==='price_changed'&&canAdd?`<button class="primary" data-accept-price="${a.id}">Revisar novo valor</button>`:''}<small>${time(a.updated_at)}</small></section>`).join('')}<div class="action-row">${canAdd?'<button class="primary" id="track-addition">Adicionar itens ao meu pedido</button>':'<p>Este pedido não aceita mais acréscimos. Faça um novo pedido para outros itens.</p>'}<button class="secondary" id="copy-order-link">Copiar link privado</button><button class="secondary" id="tracking-new-order">Fazer novo pedido</button></div><p class="private-link-note">Guarde o link privado. Ele permite consultar e complementar este pedido; compartilhe apenas com quem pode ter esse acesso.</p>${eventList(o)}</article>`;
    $('#success-addition').hidden=!canAdd;
  }
  function mode(){const draft=saved.draft;$('#addition-banner').hidden=!draft;$('#addition-checkout').hidden=!draft;$('#checkout').hidden=!!draft;$('#cart-items').hidden=!!draft?.quote;$('#empty').hidden=!!draft||cart.size>0;$('#checkout-area > .total').hidden=!!draft?.quote;$('#addition-banner-title').textContent=draft?`Complementando ${current?.code||'seu pedido'}`:'';$('#drawer > header h2').textContent=draft?'Itens adicionais':'Confira os itens';$('#submit-order').textContent=saved.checkoutAttempt?'Verificar e concluir o mesmo pedido':'Confirmar pedido';document.querySelectorAll('#checkout input,#checkout textarea,#checkout select').forEach(el=>el.disabled=!!saved.checkoutAttempt||busy);renderPicker()}
  function restoreCart(items){syncing=true;cart=new Map((items||[]).map(i=>[i.productId,i.quantity]));renderCart();syncing=false}
  function cartChanged(){if(syncing||!saved.draft)return;const values=selection(),fingerprint=JSON.stringify(values);if(saved.draft.fingerprint!==fingerprint){saved.draft.items=values;saved.draft.fingerprint=fingerprint;saved.draft.clientKey=crypto.randomUUID();saved.draft.quote=null;persist();renderReview()}mode()}
  document.addEventListener('lg-cart-changed',cartChanged);
  function canChangeCart(){if(busy||saved.checkoutAttempt||saved.draft?.locked){toast('Verifique o envio em andamento antes de alterar os itens.');return false}return true}
  function beforeAdd(){if($('#order-success').hidden===false){$('#order-success').hidden=true;$('#checkout-area').hidden=false}}
  async function refresh(show=false){if(refreshing||!token())return;refreshing=true;try{
    const data=await request('/api/customer-order');current=data.order;remember(token(),current);renderTracking();
    const draft=saved.draft,a=draft?.quote&&current.additions.find(a=>a.id===draft.quote.id);
    if(a){draft.quote=a;persist();if(['pending','applied'].includes(a.state)&&draft.locked){finish(data.order,a);return}if(['rejected','price_changed'].includes(a.state)){draft.locked=false;persist()}}
    if(draft)renderReview();if(show)message('Pedido atualizado agora.');
  }catch(e){if(show)message(e.message,true)}finally{refreshing=false}}
  async function startAddition(existing){
    if(!canChangeCart())return;if(saved.draft){close();$('#cardapio').scrollIntoView({behavior:'smooth'});return}
    await refresh(true);if(!current||!['new','preparing'].includes(current.status))return message('Este pedido não aceita mais acréscimos. Faça um novo pedido.',true);
    const items=existing?existing.items.map(i=>({productId:i.productId,quantity:i.quantity})):[];
    saved.draft={token:saved.active,clientKey:crypto.randomUUID(),items,normalCart:selection(),fingerprint:JSON.stringify(items),quote:existing||null,locked:false};
    if(!persist()){delete saved.draft;return message('Ative o armazenamento deste navegador para guardar seu pedido com segurança.',true)}
    restoreCart(items);mode();beforeAdd();close();if(existing){renderReview();open()}else $('#cardapio').scrollIntoView({behavior:'smooth'});
  }
  function leaveAddition(){if(!canChangeCart())return;const original=saved.draft?.normalCart||[];delete saved.draft;persist();restoreCart(original);mode();close();$('#meus-pedidos').scrollIntoView({behavior:'smooth'})}
  function renderReview(){
    const d=saved.draft;if(!d)return;mode();const a=d.quote,o=current;
    $('#addition-error').textContent='';
    if(!a||!o){$('#addition-review').innerHTML='<p>Selecione os produtos adicionais no cardápio. O resumo será calculado antes de você confirmar.</p>';$('#confirm-addition').textContent='Revisar acréscimo';$('#confirm-addition').disabled=busy||!cart.size;return}
    const closed=!['new','preparing'].includes(o.status),resolved=['applied','pending','rejected'].includes(a.state);
    $('#addition-review').innerHTML=`<span class="order-code">${h(o.code)}</span><p>${h(o.customer_name)} · ${h(o.customer_sector)}</p><h4>Itens já confirmados</h4>${lines(o.items)}<h4>Itens a acrescentar</h4>${lines(a.items,true)}<dl class="order-amounts"><div><dt>Total atual</dt><dd>${fmt(o.total_cents)}</dd></div><div><dt>Valor adicional</dt><dd>${fmt(a.amount_cents)}</dd></div><div class="balance"><dt>Novo total após ${o.status==='new'?'confirmar':'aprovação'}</dt><dd>${fmt(o.total_cents+a.amount_cents)}</dd></div><div><dt>Pagamento já registrado</dt><dd>${fmt(o.paid_amount_cents)}</dd></div><div><dt>Saldo após o acréscimo</dt><dd>${fmt(o.balance_cents+a.amount_cents)}</dd></div></dl>${a.state==='price_changed'?'<p class="addition-warning">O preço mudou. Confirme apenas se você aceita os novos valores acima.</p>':''}<p>${closed?'Este pedido não aceita mais acréscimos. Faça um novo pedido.':o.status==='new'?'Ao confirmar, apenas os itens adicionais serão incluídos neste pedido.':'O pedido original permanece confirmado. O acréscimo depende de aprovação e de estoque disponível nesse momento.'}</p>${a.reason?`<p>${h(a.reason)}</p>`:''}`;
    $('#confirm-addition').textContent=d.locked?'Verificar e concluir o mesmo envio':a.state==='price_changed'?'Aceitar novo valor e continuar':o.status==='new'?'Confirmar acréscimo':'Solicitar acréscimo';$('#confirm-addition').disabled=busy||closed||resolved;$('#edit-addition').disabled=busy||!!d.locked;
  }
  async function review(){if(!saved.draft)return;if(saved.draft.quote){renderReview();open();return}if(!cart.size)return toast('Selecione os itens adicionais.');if(busy)return;busy=true;mode();try{
    const d=saved.draft;const data=await request('/api/customer-order?action=quote',{method:'POST',body:JSON.stringify({clientKey:d.clientKey,items:d.items})});current=data.order;d.quote=data.addition;persist();renderTracking();renderReview();open();
  }catch(e){toast(e.message);message(e.message,true);await load()}finally{busy=false;renderReview()}}
  function finish(order,addition){const original=saved.draft?.normalCart||[];current=order;delete saved.draft;persist();restoreCart(original);mode();renderTracking();close();message(addition.state==='applied'?'Pedido atualizado com sucesso':'Solicitação de acréscimo enviada');toast(addition.state==='applied'?'Pedido atualizado com sucesso':'Solicitação de acréscimo enviada');$('#meus-pedidos').scrollIntoView({behavior:'smooth'});load()}
  async function submit(){const d=saved.draft;if(!d?.quote)return review();if(busy)return;busy=true;d.locked=true;if(!persist()){busy=false;d.locked=false;return toast('Não foi possível guardar o envio. Verifique o armazenamento do navegador.')}renderReview();try{
    const data=await request('/api/customer-order?action=submit',{method:'POST',body:JSON.stringify({additionId:d.quote.id,expectedRevision:d.quote.revision,expectedOrderRevision:current.revision})});finish(data.order,data.addition);
  }catch(e){if(e.data?.order){current=e.data.order;renderTracking()}if(e.data?.addition)d.quote=e.data.addition;if(e.status&&e.status<500)d.locked=false;persist();renderReview();$('#addition-error').textContent=e.message+(d.locked?' Use “Verificar e concluir o mesmo envio”. Não é preciso refazer o pedido.':'');}finally{busy=false;mode();if(saved.draft){const text=$('#addition-error').textContent;renderReview();$('#addition-error').textContent=text}}}
  async function checkout(e){e.preventDefault();if(saved.draft)return review();if(busy)return;if(!saved.checkoutAttempt&&!cart.size)return toast('Adicione pelo menos um produto');
    if(!saved.checkoutAttempt){saved.checkoutAttempt={accessToken:random(),name:$('#customer-name').value.trim(),sector:$('#customer-sector').value.trim(),phone:$('#customer-phone').value.trim(),note:$('#customer-note').value.trim(),paymentMethod:$('#payment-method').value,items:selection()};if(!persist()){delete saved.checkoutAttempt;return toast('Ative o armazenamento deste navegador para guardar seu pedido.')}}
    busy=true;$('#submit-order').disabled=true;$('#submit-order').textContent='Registrando pedido…';try{
      const attempt=saved.checkoutAttempt;const data=await request('/api/orders',{method:'POST',body:JSON.stringify(attempt)});current=data.order;remember(data.accessToken,current);delete saved.checkoutAttempt;persist();cart.clear();renderCart();$('#order-code').textContent=data.code;$('#checkout-area').hidden=true;$('#order-success').hidden=false;renderTracking();message('Pedido recebido. Guarde seu link privado para acompanhar.');await load();
    }catch(e){if(e.status&&e.status<500&&e.data?.code!=='IDEMPOTENCY'){delete saved.checkoutAttempt;persist()}toast(e.message);message(e.message+(saved.checkoutAttempt?' Reabra o pedido e use “Verificar e concluir o mesmo pedido” para recuperar esse envio.':''),true)}finally{busy=false;$('#submit-order').disabled=false;mode()}}
  function newOrder(){if(!canChangeCart())return;if(saved.draft)leaveAddition();$('#order-success').hidden=true;$('#checkout-area').hidden=false;mode();close();$('#cardapio').scrollIntoView({behavior:'smooth'})}
  $('#checkout').onsubmit=checkout;$('#new-order').onclick=newOrder;
  $('#success-addition').onclick=()=>startAddition();$('#success-track').onclick=()=>{close();$('#meus-pedidos').scrollIntoView({behavior:'smooth'});refresh(true)};
  $('#refresh-tracking').onclick=()=>refresh(true);$('#review-addition').onclick=review;$('#confirm-addition').onclick=submit;$('#exit-addition').onclick=leaveAddition;
  $('#edit-addition').onclick=()=>{if(canChangeCart()){saved.draft.quote=null;saved.draft.clientKey=crypto.randomUUID();persist();mode();close();$('#cardapio').scrollIntoView({behavior:'smooth'})}};
  $('#order-picker').onchange=()=>{if(saved.draft||busy)return;saved.active=saved.orders[Number($('#order-picker').value)]?.token;current=null;persist();refresh(true)};
  $('#tracking-content').onclick=async e=>{const b=e.target.closest('button');if(!b)return;if(b.id==='track-addition')startAddition();if(b.id==='tracking-new-order')newOrder();if(b.dataset.acceptPrice)startAddition(current.additions.find(a=>a.id===b.dataset.acceptPrice));if(b.id==='copy-order-link'){const link=location.origin+location.pathname+'#pedido='+saved.active;try{await navigator.clipboard.writeText(link);message('Link privado copiado. Guarde-o com cuidado.')}catch{prompt('Copie seu link privado:',link)}}};
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh()});setInterval(()=>{if(!document.hidden&&!busy)refresh()},8000);
  window.LGOrders={canChangeCart,beforeAdd,checkout};
  if(saved.checkoutAttempt){const a=saved.checkoutAttempt;for(const [id,value] of [['customer-name',a.name],['customer-sector',a.sector],['customer-phone',a.phone],['customer-note',a.note],['payment-method',a.paymentMethod]])$('#'+id).value=value;restoreCart(a.items);message('Há um envio para verificar. Abra “Pedido” e conclua o mesmo envio. Não é preciso criar outro.');open()}
  if(saved.draft){restoreCart(saved.draft.items);mode()}
  renderPicker();mode();refresh(!!fragment);
})();
