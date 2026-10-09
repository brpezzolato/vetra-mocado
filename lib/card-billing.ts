import type { CardBankId } from './payment-cards';
export const BILLING_RULES: Record<
  CardBankId,
  {
    days: number | null;
    label: string;
    url?: string;
    dueDays?: readonly number[];
    accuracy: 'exact' | 'estimate' | 'none';
  }
> = {
  nubank: {
    days: 7,
    accuracy: 'exact',
    label:
      'Informe o vencimento mostrado no app Nubank. O Vetra calcula o fechamento exatamente 7 dias corridos antes.',
    url: 'https://blog.nubank.com.br/data-de-vencimento-data-fechamento-cartao-de-credito/',
  },
  picpay: {
    days: 6,
    accuracy: 'estimate',
    dueDays: [5, 10, 15, 20, 25],
    label:
      'Escolha um dos vencimentos oferecidos pelo PicPay. O fechamento ocorre cerca de 6 dias antes.',
    url: 'https://meajuda.picpay.com/hc/pt-br/articles/360049689032-Quando-fecha-a-fatura-do-PicPay-Card',
  },
  // Itaú fecha 7 dias antes do vencimento; no Vetra o fechamento é o dia
  // seguinte (melhor data de compra): 6.
  itau: {
    days: 6,
    accuracy: 'estimate',
    label:
      'Informe o vencimento da fatura Itaú. O Itaú fecha a fatura 7 dias antes do vencimento, e a melhor data de compra é o dia seguinte; feriados podem mudar a data em algum mês.',
    url: 'https://www.itau.com.br/atendimento-itau/para-voce/cartao-de-credito/quando-ocorre-o-fechamento-da-fatura-do-meu-cartao',
  },
  'mercado-pago': {
    days: 7,
    accuracy: 'estimate',
    label:
      'Informe o vencimento da fatura do Mercado Pago. O Vetra estima o fechamento 7 dias antes; com o banco conectado, usa as datas reais das faturas.',
  },
  flash: {
    days: null,
    accuracy: 'none',
    label:
      'Flash Benefícios é pré-pago: a compra usa o saldo disponível e não possui fatura, fechamento ou vencimento.',
    url: 'https://flashapp.com.br/cartao-flash',
  },
  other: {
    days: null,
    accuracy: 'none',
    label: 'Escolha o banco para configurar o ciclo.',
  },
};
