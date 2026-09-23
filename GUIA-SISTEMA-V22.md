# Sistema de Gestão L&G Delícias — v22

## Primeira configuração

1. Publique todos os arquivos do pacote.
2. Entre na Central de Pedidos.
3. Abra a aba **Estoque**.
4. Informe o saldo real de cada produto e clique em **Salvar**.
5. Na aba **Pedidos**, clique em **Ativar alertas** e permita as notificações.

Enquanto o saldo estiver em branco, o produto continuará sendo vendido sem controle de quantidade. Depois que um saldo for informado, cada novo pedido fará a baixa automática.

## Regras automáticas

- Saldo zero bloqueia novas vendas e mostra **Produto esgotado**.
- Cancelar um pedido devolve os itens ao estoque.
- Excluir um pedido ativo também devolve os itens ao estoque.
- Reabrir um pedido cancelado desconta novamente o estoque e só é permitido quando houver saldo.
- O aviso de estoque baixo pode ser configurado individualmente.
- Todo pedido começa com pagamento **Pendente**.
- O administrador pode alterar o pagamento para **Pago** no cartão do pedido.
- Pedidos cancelados não entram nos totais financeiros.

## Alertas de novos pedidos

Com a Central aberta, o sistema verifica novos pedidos a cada 8 segundos e dispara som e notificação do navegador.

Para alerta externo pelo WhatsApp, configure no Cloudflare as variáveis descritas no `README.md`. O modelo aprovado deve receber, nesta ordem:

1. Código do pedido
2. Nome do cliente
3. Valor total

## Segurança

- O painel continua protegido pela variável `ADMIN_KEY`.
- O servidor valida preços, disponibilidade e estoque; não confia nos valores enviados pelo navegador.
- Nunca coloque tokens ou senhas diretamente nos arquivos do projeto.
