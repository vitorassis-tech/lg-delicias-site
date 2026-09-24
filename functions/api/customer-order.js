import {setup,json,failure,bodyOf,customerOrder,snapshot,Problem} from '../../server/order-core.js';
import {quoteAddition,submitAddition} from '../../server/additions.js';
export async function onRequestGet({request,env}){try{await setup(env.DB);const o=await customerOrder(request,env.DB);return json({order:await snapshot(env.DB,o.id)})}catch(e){return failure(e)}}
export async function onRequestPost({request,env}){try{await setup(env.DB);const o=await customerOrder(request,env.DB),body=await bodyOf(request),action=new URL(request.url).searchParams.get('action');if(action==='quote')return json(await quoteAddition(env.DB,o,body));if(action==='submit')return json(await submitAddition(env.DB,o,body));throw new Problem('Operação inválida.')}catch(e){return failure(e)}}
