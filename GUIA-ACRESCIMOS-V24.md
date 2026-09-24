# L&G Delícias — adicionar itens ao mesmo pedido (v24)

Pacote completo do projeto, com as melhorias do cardápio v23 e o fluxo de acréscimos. A atualização foi implementada e testada em ambiente local. A publicação no seu domínio acontece após substituir os arquivos e enviar o commit ao GitHub.

## 1. Publicar a atualização

1. Extraia o ZIP. Abra a pasta `lg-delicias-site` que está dentro dele.
2. Copie **todo o conteúdo dessa pasta** para a pasta do projeto que você já abre no VS Code, substituindo os arquivos existentes. Inclua as novas pastas `server` e `tests` e os novos arquivos de interface. Evite criar uma pasta `lg-delicias-site` dentro de outra com o mesmo nome.
3. Mantenha a pasta `.git` do seu projeto e suas configurações locais. O pacote não contém chaves de acesso, banco de produção ou credenciais do WhatsApp.
4. No terminal do VS Code, dentro do seu projeto, execute:

```powershell
git status
git add app.js index.html additions.css customer-orders.js admin functions server schema.sql README.md GUIA-ACRESCIMOS-V24.md tests validacao .gitignore _headers
git commit -m "Adiciona acrescimos seguros aos pedidos"
git push origin main
```

5. No Cloudflare, abra **Workers & Pages → lg-delicias-site → Deployments**. Aguarde o novo commit aparecer com sucesso em **Production**.
6. Abra o site e a Central novamente. No computador, use `Ctrl + F5` para carregar os novos arquivos. Clique em **Ativar alertas** na Central e permita o som/notificações quando solicitado.

### Configuração do Cloudflare

- Continue usando o mesmo projeto Cloudflare Pages, o mesmo vínculo D1 chamado `DB` e a variável secreta `ADMIN_KEY` já existentes.
- **Não há nova variável obrigatória nem serviço pago adicional para os acréscimos.**
- As novas colunas e tabelas são criadas automaticamente na primeira chamada à API de pedidos, inclusive ao abrir a Central. Os dados antigos são mantidos.
- **Não apague, recrie nem importe um banco vazio. Não execute `schema.sql` sobre o banco existente para atualizar.** Esse arquivo é a referência para instalações novas; a migração do banco existente está no servidor.
- A pasta `server` precisa acompanhar `functions`: as Functions importam os módulos dessa pasta.
- Mantenha as configurações atuais de build e diretório de saída. O projeto continua com HTML/CSS/JavaScript e Pages Functions, sem uma nova etapa obrigatória de build.
- As configurações existentes da API do WhatsApp continuam independentes. O acréscimo informa o resultado na tela do cliente e na Central; não envia mensagens extras de WhatsApp.

## 2. Como o cliente usa

Após confirmar um pedido, o cliente vê **Adicionar itens ao meu pedido** e **Acompanhar pedido**. O acesso também fica em **Meus pedidos**, no topo do site.

Ao acrescentar itens:

1. O site identifica qual pedido está sendo complementado.
2. O cliente seleciona somente os produtos adicionais no cardápio.
3. A revisão mostra os itens atuais, os adicionais, o valor adicional, o novo total, o valor já recebido e o novo saldo pendente.
4. O cliente confirma o acréscimo ou envia a solicitação, conforme o status.

O carrinho de um eventual novo pedido é guardado separadamente e restaurado ao sair do modo de acréscimo. Nome, setor, telefone, observação e forma de pagamento do pedido existente permanecem preservados.

### Regras por status

| Status na Central | Comportamento |
| --- | --- |
| Novo / aguardando confirmação | Acrescenta diretamente, depois da validação de estoque e preço no servidor. |
| Confirmado / em preparo (`preparing`) | Envia uma solicitação. Itens e total originais permanecem inalterados até a aprovação. |
| Pronto | Bloqueia acréscimos e orienta criar outro pedido. |
| Finalizado ou cancelado | Bloqueia acréscimos e orienta criar outro pedido. |

Ao tornar um pedido pronto, finalizado ou cancelado, as solicitações ainda abertas são encerradas sem cobrar nem baixar os adicionais. O cliente recebe uma explicação no acompanhamento.

### Acesso privado e recuperação

- Cada pedido novo recebe uma chave aleatória de 256 bits. O banco guarda somente seu hash.
- O número do pedido sozinho não permite consultar nem modificar o pedido.
- O navegador guarda o acesso neste aparelho. Após atualizar ou fechar a página, basta voltar a **Meus pedidos**.
- **Copiar link privado** permite guardar o acesso ou abri-lo em outro aparelho. O segredo é retirado da barra de endereço ao abrir a página; as chamadas à API usam um cabeçalho privado.
- Se o navegador apagar seus dados, use o link privado salvo. Sem ele, solicite um novo link à L&G.
- Para pedidos antigos, a Central oferece **Gerar link privado para cliente**. O administrador deve conferir o cliente e enviar o link manualmente. Gerar outro link desativa os anteriores.
- Enquanto houver um envio com resultado incerto, o site preserva os dados e reaproveita o mesmo identificador. Use **Verificar e concluir o mesmo envio**; não é preciso criar outro pedido.

## 3. Como funciona na Central

- Novidades aparecem em um aviso visual com código do pedido, cliente, itens, quantidades e valor.
- Solicitações pendentes aparecem separadas, com **Aprovar acréscimo** e **Recusar acréscimo**.
- Na recusa, informe o motivo. O texto fica disponível para o cliente.
- Na aprovação, o servidor verifica novamente estoque, preço, status e versão do pedido. Se faltarem unidades, a aprovação é bloqueada e o painel informa qual produto está sem estoque suficiente.
- Se o preço mudou, a Central informa que o cliente precisa aceitar o novo valor. Depois desse aceite, o administrador pode aprovar novamente.
- O histórico registra itens, quantidades, preço unitário, valor, total antes/depois, horário e perfil responsável: **Cliente**, **Administrador** ou **Sistema**. A autenticação administrativa atual utiliza uma chave compartilhada, portanto o registro não identifica individualmente funcionários diferentes.

### Alertas e atualização

A Central e o acompanhamento consultam atualizações a cada **8 segundos**, enquanto a página está ativa. Ao retornar à aba, fazem uma nova consulta. Os avisos da Central usam um cursor de eventos para recuperar alterações após uma falha temporária de conexão.

O som depende de clicar em **Ativar alertas** e das permissões do navegador. Não há garantia de alertas com o navegador fechado ou com a página suspensa pelo celular. Este pacote não instala um serviço de notificações push em segundo plano.

## 4. Estoque e financeiro

- A baixa de um pedido novo ou de um acréscimo efetivado ocorre em uma transação no servidor.
- Somente as unidades adicionais são descontadas no acréscimo.
- Solicitação pendente não reserva estoque nem altera a cobrança.
- Aprovação simultânea e venda simultânea disputam o estoque de forma protegida: a última unidade só pode ser vendida uma vez.
- Envio repetido, clique duplo e recuperação após resposta perdida reutilizam o mesmo pedido/acréscimo.
- Preços dos itens antigos são mantidos. Quando o mesmo produto é acrescido por outro preço, o resumo mantém linhas distintas para preservar o histórico dos valores.
- Um pedido já pago mantém o valor recebido. Apenas o adicional aprovado fica pendente.
- No financeiro, **Total recebido** e **Total pendente** consideram o valor efetivamente registrado, inclusive pagamentos parciais após acréscimos.
- Marcar **Pagamento recebido** quita o saldo atual. Voltar um pedido totalmente pago para pendente exige confirmar o estorno do registro.
- Fiado/prazo permanece na mesma conta do pedido. Não há integração nova com banco, cartão ou Pix: o sistema registra o controle financeiro, sem debitar dinheiro automaticamente.

### Exemplo conferido

| Etapa | Itens | Total | Se os R$ 15,00 iniciais já estiverem pagos |
| --- | --- | --- | --- |
| Pedido inicial | 1 Guaracamp + 1 Torta Salgada Grande | R$ 15,00 | Saldo R$ 0,00 |
| Acréscimo efetivado | 1 Guaracamp + 2 Tortas Salgadas Grandes | R$ 28,00 | Saldo R$ 13,00 |

Com 30 unidades de torta antes do pedido: 29 após o pedido inicial e 28 após efetivar o acréscimo. O código do pedido é mantido.

## 5. Validação entregue

Todos os testes usam dados fictícios e banco local descartável. Nenhum pedido, cobrança ou mensagem real foi gerado.

- **23 testes de regras/API com SQLite:** exemplo, pedido pago, fiado, aprovação, recusa, estoque insuficiente, concorrência pela última unidade, duplicidade, estados encerrados, mudança de preço, acesso seguro, migração de pedidos antigos, cursor de avisos e devolução de estoque compatível com os controles anteriores.
- **12 cenários de navegador com Chromium:** fluxo de ponta a ponta, duplo clique, acesso após fechar/atualizar, aprovação, recusa, pedido pago, falta de estoque, bloqueio de pedido pronto, falhas de conexão com resposta perdida, novo aceite de preço, link privado em outro navegador e alerta visual/sonoro sem repetir o mesmo evento. Conferida ausência de rolagem horizontal em 320, 390 e 1.440 pixels.
- **5 verificações com D1 local real via Miniflare/workerd:** acréscimo e saldo pago, idempotência, aprovação, concorrência pela última unidade e reversão completa da transação em caso de falha.
- **Compilação das Pages Functions concluída com Wrangler 3.114.17**, a versão mostrada nos logs anteriores do seu projeto.

As verificações locais não substituem a confirmação do status **Success** do novo deploy. Não foram usados o banco nem as credenciais de produção.

As imagens em `validacao/` mostram a revisão no computador, o acompanhamento no celular e a aprovação na Central, todos com dados fictícios.

### Repetir os testes (opcional, ambiente de desenvolvimento)

Node.js 24 ou superior para o adaptador SQLite local:

```bash
node --test tests/order-additions.test.mjs
```

Para testes visuais e do runtime, instale dependências apenas no ambiente local:

```bash
npm install --no-save --package-lock=false playwright miniflare@3
npx playwright install chromium
node tests/browser-flow.mjs
node tests/browser-alerts.mjs
node tests/cloudflare-runtime.mjs
```

Para abrir o projeto com dados fictícios:

```bash
node tests/local-server.mjs
```

Acesse `http://127.0.0.1:4173/`. A chave de **teste local** é `local-test-only`. O servidor vincula somente a interface local, não usa seu D1 de produção e não tem credenciais de mensagens. Os controles `/__test/` existem somente nesse servidor de testes; não são Pages Functions.

## 6. Arquivos principais

- `customer-orders.js` e `additions.css`: acompanhamento, revisão, recuperação de envio e apresentação responsiva.
- `admin/additions-admin.js`: solicitações, histórico, alertas e saldos parciais na Central.
- `functions/api/customer-order.js`: API privada do cliente.
- `functions/api/orders.js`: integração dos pedidos e das ações administrativas.
- `server/order-core.js`: migração, acesso, leitura e transações.
- `server/additions.js`: cotação, aceite, aprovação e recusa.
- `server/order-http.js`: criação, financeiro e ações administrativas.
- `server/notifications.js`: configurações de WhatsApp que já existiam.
- `tests/`: testes reproduzíveis com dados fictícios.

As imagens de produtos, as descrições confirmadas, os destaques e a identidade visual do cardápio foram preservados. Os dados de produto ainda não confirmados continuam listados em `DADOS-PENDENTES-CARDAPIO.md`.
