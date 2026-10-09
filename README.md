# vetra-mocado

Protótipo navegável do **Vetra**, um app de finanças pessoais que junta
contas, cartões, faturas, benefícios e cofrinhos numa visão só.

Esta versão é só para demonstração: **todos os números são fictícios**. Não há
banco de dados, conexão com bancos nem IA. A tela de login aceita qualquer
e-mail e senha, e nada do que se faz no site é salvo ou enviado.

## Rodando

```bash
npm install
npm run dev
```

Abra http://localhost:3000. Não precisa de `.env`.

## O que dá para ver

- **Início**: quanto ainda dá para gastar no mês e hoje, saldos dos bancos,
  últimos gastos, resumo da semana e cofrinhos.
- **Gastos, Resumo e Gráficos**: extrato, calendário do mês e para onde o
  dinheiro vai.
- **Faturas, Assinaturas e Benefícios**: cartões, cobranças recorrentes e o
  cartão Flash.
- **Cofrinhos**: rendimento diário e previsão.
- **Vetra AI**: o porquinho responde perguntas sobre os gastos fictícios.

Feito com Next.js, React, Tailwind e shadcn/ui.
