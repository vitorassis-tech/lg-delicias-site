// Extends the existing Central without replacing catalogue and stock controls.
(() => {
  'use strict';
  let adminBusy=false, polling=false, cursor=null, notices=[];
  let soundEnabled=false;const basePlay=playAlert;
  playAlert=()=>{if(soundEnabled)basePlay()};
  $('#enable-alerts').addEventListener('click',()=>{soundEnabled=true},{capture:true});
  const fmt=n=>money(Number(n||0)/100),h=escapeHtml;
  const labels={created:'Pedido recebido',addition_requested:'Acréscimo solicitado',addition_applied:'Acréscimo efetivado',addition_rejected:'Acréscimo recusado',price_changed:'Preço atualizado',status:'Status atualizado',payment:'Pagamento atualizado',access_issued:'Link privado emitido'};
  const itemLines=items=>`<ul class="addition-items">${items.map(i=>`<li><span>${i.quantity}× ${h(i.name)}<small>${fmt(i.unitCents)} cada</small></span><strong>${fmt(i.subtotalCents)}</strong></li>`).join('')}</ul>`;
  const findOrder=id=>[...orders,...historyOrders,...financeOrders].filter(o=>Number(o.id)===Number(id)).sort((a,b)=>b.revision-a.revision)[0];
  $('.admin-tabs').insertAdjacentHTML('afterend','<aside class="live-additions-alert" id="addition-alerts" hidden aria-live="polite"><strong>Novidades nos pedidos</strong><ul id="addition-notices"></ul><button class="secondary" id="dismiss-additions">Marcar avisos como lidos</button></aside>');
  $('#orders-list').insertAdjacentHTML('beforebegin','<p id="pending-additions-count" class="pending-additions-count" hidden></p>');
  $('#dismiss-additions').onclick=()=>{notices=[];$('#addition-alerts').hidden=true};
  const baseCard=orderCard;
  orderCard=function(o){
    const waiting=o.additions.filter(a=>['pending','price_changed'].includes(a.state));
    const pending=waiting.map(a=>`<section class="addition-box state-${a.state}"><h4>${a.state==='pending'?'Acréscimo aguardando aprovação':'Aguardando aceite do novo preço pelo cliente'}</h4><small>${dateTime(a.created_at)} · ${h(a.actor)}</small>${itemLines(a.items)}<p><strong>Adicional: ${fmt(a.amount_cents)}</strong></p><p>Se aprovado, total de ${fmt(o.total_cents+a.amount_cents)} e saldo pendente de ${fmt(o.balance_cents+a.amount_cents)}.</p><p>Estoque e cobrança serão atualizados somente na aprovação.</p>${a.reason?`<p>${h(a.reason)}</p>`:''}<div class="action-row">${a.state==='pending'?`<button class="primary" data-addition-decision="approve" data-id="${o.id}" data-addition="${a.id}" data-revision="${a.revision}">Aprovar acréscimo</button>`:''}<button class="secondary addition-reject" data-addition-decision="reject" data-id="${o.id}" data-addition="${a.id}" data-revision="${a.revision}">Recusar acréscimo</button></div></section>`).join('');
    const amounts=`<dl class="order-amounts"><div><dt>Valor já recebido</dt><dd>${fmt(o.paid_amount_cents)}</dd></div><div class="balance"><dt>Saldo pendente</dt><dd>${fmt(o.balance_cents)}</dd></div></dl>`;
    const audit=`<details class="order-audit"><summary>Histórico de alterações (${o.events.length})</summary><ol>${o.events.map(e=>`<li><strong>${h(labels[e.kind]||e.kind)}</strong><small>${dateTime(e.created_at)} · ${h(e.actor)}</small>${e.items.length?itemLines(e.items):''}${e.amount_cents?`<p>Valor dos itens: ${fmt(e.amount_cents)}</p>`:''}${e.total_after_cents!==null?`<p>Total: ${fmt(e.total_before_cents)} → ${fmt(e.total_after_cents)}</p>`:''}<p>${h(e.note.replace(/Status: (\w+) → (\w+)\./,(_,a,b)=>`Status: ${statusLabels[a]||a} → ${statusLabels[b]||b}.`))}</p></li>`).join('')}</ol></details>`;
    let html=baseCard(o).replace('<footer>',amounts+pending+audit+'<footer>').replace('Pago em ','Pagamento registrado em ');
    if(o.paid_amount_cents>0&&o.balance_cents>0)html=html.replace('<span class="payment-badge">Pendente</span>','<span class="payment-badge payment-partial">Pagamento parcial</span>');
    return html.replace('</footer>',`<button type="button" class="secondary admin-link" data-access-id="${o.id}">Gerar link privado para cliente</button></footer>`);
  };
  const baseRender=renderOrders;
  renderOrders=function(){baseRender();const count=orders.reduce((n,o)=>n+o.additions.filter(a=>a.state==='pending').length,0),box=$('#pending-additions-count');box.hidden=!count;box.textContent=`${count} solicitação(ões) de acréscimo aguardando aprovação nos pedidos exibidos.`};
  async function pollUpdates(){if(polling||!key)return;polling=true;try{
    let more=true;while(more){const r=await api('/api/orders?updates=1'+(cursor===null?'':'&after='+cursor));if(!r.ok)break;const data=await r.json();cursor=data.cursor;more=data.more;const changes=data.events.filter(e=>['addition_requested','addition_applied','price_changed'].includes(e.kind));
      if(changes.length){for(const e of changes){const what=e.items.map(i=>`${i.quantity}× ${i.name}`).join(', ');notices.unshift(`${e.code} · ${e.customer_name} — ${e.kind==='addition_applied'?'Adicionado':e.kind==='addition_requested'?'Acréscimo solicitado':'Novo preço aguardando aceite'}: ${what} (${fmt(e.amount_cents)}).`)}$('#addition-notices').innerHTML=notices.map(n=>'<li>'+h(n)+'</li>').join('');$('#addition-alerts').hidden=false;playAlert();if('Notification'in window&&Notification.permission==='granted')new Notification('Acréscimo — L&G Delícias',{body:notices[0],icon:'/assets/logo.jpg'});}
    }
  }catch{$('#orders-status').textContent='Sem conexão. Os avisos serão recuperados na próxima atualização.'}finally{polling=false}}
  const baseLoad=loadOrders;
  loadOrders=async function(silent=false){if(adminBusy)return;try{await baseLoad(silent);await pollUpdates()}catch{$('#orders-status').textContent='Sem conexão. Tentaremos atualizar novamente.'}};
  startRefresh=function(){clearInterval(refreshTimer);cursor=null;pollUpdates();refreshTimer=setInterval(()=>{if(!adminBusy)loadOrders(true)},8000)};
  async function refreshAll(){await loadOrders(true);await loadProducts();if(!$('#history').hidden)await loadHistory();if(!$('#finance').hidden)await loadFinance()}
  updateOrder=async function(id,payload,select){
    if(adminBusy)return;const o=findOrder(id);if(!o)return;
    if(payload.paymentStatus==='pending'&&o.payment_status==='paid'){if(!confirm(`Estornar o pagamento registrado de ${fmt(o.paid_amount_cents)} e voltar todo o saldo para pendente?`)){if(select)select.value='paid';return}payload.resetPayment=true}
    payload.expectedRevision=o.revision;adminBusy=true;if(select)select.disabled=true;
    try{const r=await api('/api/orders?id='+id,{method:'PATCH',body:JSON.stringify(payload)}),data=await responseData(r);if(!r.ok)throw new Error(data.error||'Não foi possível atualizar.');if(data.notification?.mode==='manual')window.open(`https://wa.me/${data.notification.phone}?text=${encodeURIComponent(data.notification.message)}`,'_blank','noopener');else if(data.notification?.mode==='automatic'&&data.notification.sent)alert('Pedido confirmado e cliente avisado pelo WhatsApp.');
    }catch(e){alert(e.message)}finally{adminBusy=false;if(select)select.disabled=false;await refreshAll()}
  };
  async function decide(button){if(adminBusy)return;const decision=button.dataset.additionDecision;let reason='';if(decision==='reject'){reason=prompt('Informe o motivo da recusa. O cliente verá esta mensagem:','');if(reason===null)return;if(!reason.trim())return alert('Informe um motivo para o cliente.')}adminBusy=true;button.disabled=true;
    try{const r=await api('/api/orders?id='+button.dataset.id,{method:'PATCH',body:JSON.stringify({action:'addition',additionId:button.dataset.addition,decision,reason,expectedRevision:Number(button.dataset.revision)})}),data=await responseData(r);if(!r.ok)throw new Error(data.error||'Não foi possível decidir.');
    }catch(e){alert(e.message)}finally{adminBusy=false;await refreshAll()}
  }
  async function issueLink(button){if(adminBusy)return;if(!confirm('Gerar um novo link privado? Os links anteriores deste pedido deixarão de funcionar. Envie o novo link apenas ao cliente correto.'))return;adminBusy=true;button.disabled=true;try{const r=await api('/api/orders?id='+button.dataset.accessId,{method:'PATCH',body:JSON.stringify({action:'access'})}),data=await responseData(r);if(!r.ok)throw new Error(data.error||'Não foi possível gerar o link.');const link=location.origin+'/#pedido='+data.accessToken;try{await navigator.clipboard.writeText(link);alert('Link privado copiado. Envie-o somente ao cliente deste pedido.')}catch{prompt('Copie e envie somente ao cliente deste pedido:',link)}}catch(e){alert(e.message)}finally{adminBusy=false;await refreshAll()}}
  for(const id of ['orders-list','history-list','finance-list'])$('#'+id).addEventListener('click',e=>{const b=e.target.closest('button');if(b?.dataset.additionDecision)decide(b);if(b?.dataset.accessId)issueLink(b)});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!adminBusy)loadOrders(true)});
})();
