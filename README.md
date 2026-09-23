# L&G Delícias

## Cardápio profissional v23

- Descrições curtas e padronizadas em todos os produtos.
- Seção “Destaques da L&G” com até seis itens.
- Seleção e ordenação dos destaques na área administrativa.
- Categorias na ordem: Tortas Salgadas, Assados, Fritos, Sobremesas e Bebidas.
- Estoque, indisponibilidade e bloqueio de produtos esgotados preservados.
- Layout responsivo com descrição limitada a duas linhas.

As colunas `description`, `featured` e `featured_order` são criadas automaticamente no banco D1 na primeira abertura do cardápio. Consulte `DADOS-PENDENTES-CARDAPIO.md` para os dados que ainda podem enriquecer as descrições.

Site oficial para consulta do cardápio, pedidos, estoque e controle financeiro. O projeto usa Cloudflare Pages Functions e Cloudflare D1.

## Recursos

- Cardápio responsivo por categorias
- Carrinho com validação da quantidade disponível
- Baixa automática do estoque a cada pedido
- Produto esgotado automaticamente quando o saldo chega a zero
- Devolução do estoque ao cancelar ou excluir um pedido
- Alerta sonoro e notificação do navegador para novos pedidos
- Status operacional: novo, confirmado, pronto, finalizado e cancelado
- Status financeiro: pago ou pendente
- Formas de pagamento: prazo/fiado, Pix, dinheiro e cartão
- Painel financeiro por cliente, telefone e período
- Indicadores de total vendido, recebido e pendente
- Aviso de estoque baixo configurável por produto
- Confirmação do cliente por WhatsApp, quando a API estiver configurada

## Ativação do estoque

Produtos antigos começam com o saldo em branco para preservar o funcionamento atual. No painel **Estoque**, informe a quantidade real e clique em **Salvar**. A partir desse momento a baixa será automática. Saldo zero bloqueia a venda e mostra **Produto esgotado**.

## Alertas

No painel de pedidos, clique uma vez em **Ativar alertas** e permita notificações no navegador. A Central consulta pedidos novos a cada 8 segundos e dispara alerta visual e sonoro.

Para receber também o pedido novo pelo WhatsApp, configure no Cloudflare:

- `WHATSAPP_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_ADMIN_PHONE` (com DDI 55)
- `WHATSAPP_ADMIN_TEMPLATE_NAME` (modelo aprovado com código, cliente e total)

As variáveis já usadas para confirmar o cliente continuam sendo `WHATSAPP_TEMPLATE_NAME`, `WHATSAPP_TOKEN` e `WHATSAPP_PHONE_NUMBER_ID`.

Nunca salve senhas, tokens ou dados de clientes neste repositório.
