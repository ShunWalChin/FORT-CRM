/**
 * Fila de envio: o que faz a vistoria sobreviver ao wi-fi da oficina.
 *
 * Uma vistoria completa são 86 marcações, feitas em pé ao lado do elevador,
 * onde o sinal cai atrás da coluna e volta na porta. Sem fila, cada toque era
 * uma chamada síncrona: o técnico marcava, a rede falhava, a tela mostrava um
 * aviso vermelho e o trabalho da última meia hora dependia de ele lembrar em
 * quais itens o aviso apareceu.
 *
 * Três decisões:
 *
 *   1. **A tela anda na frente.** O toque pinta o item na hora; o envio vai
 *      para a fila. Esperar a rede a cada item torna a vistoria lenta demais
 *      para ser feita de verdade — e o que é lento demais é preenchido depois,
 *      no computador, de memória, que é exatamente o que a vistoria existe
 *      para impedir.
 *
 *   2. **A fila sobrevive à aba.** Fica no `localStorage`, não só em memória:
 *      celular em oficina fica com a tela apagada no bolso e o navegador mata
 *      a aba para liberar memória. Ao reabrir, o que faltava é enviado.
 *
 *   3. **Uma chave por alvo.** Marcar "atenção" e depois "crítico" no mesmo
 *      item não enfileira dois envios: o segundo substitui o primeiro. Sem
 *      isso a fila cresceria com estados que já não valem, e o último a chegar
 *      poderia ser o primeiro que foi marcado.
 *
 * O que NÃO entra aqui: foto e vídeo. Um vídeo de 30 MB não cabe no
 * `localStorage` (o teto é ~5 MB por origem) e enfileirá-lo derrubaria a fila
 * inteira. Mídia é enviada na hora, com o erro dito na cara de quem está com o
 * telefone na mão.
 */

const CHAVE = 'fortcrm.fila.v1';
const ESPERAS = [1000, 3000, 8000, 20000, 45000];

export function criarFila({ enviar, aoMudar }) {
  /** @type {{chave:string, caminho:string, metodo:string, corpo:any, tentativas:number}[]} */
  let itens = [];
  let rodando = false;
  let timer = null;
  let ultimoErro = null;

  try {
    itens = JSON.parse(localStorage.getItem(CHAVE) ?? '[]');
    if (!Array.isArray(itens)) itens = [];
  } catch {
    itens = [];
  }

  const gravar = () => {
    try {
      localStorage.setItem(CHAVE, JSON.stringify(itens));
    } catch {
      // Cota estourada. A fila continua em memória — perder o aviso é melhor
      // do que perder a marcação que o técnico acabou de fazer.
    }
  };

  const avisar = () => aoMudar?.({
    pendentes: itens.length,
    enviando: rodando,
    online: navigator.onLine,
    erro: ultimoErro,
  });

  async function girar() {
    if (rodando || !itens.length) return;
    if (!navigator.onLine) { avisar(); return; }

    rodando = true;
    avisar();

    while (itens.length) {
      const t = itens[0];
      try {
        await enviar(t);
        itens.shift();
        ultimoErro = null;
        gravar();
        avisar();
      } catch (e) {
        /*
         * 4xx não é falta de rede: é o servidor dizendo que o pedido está
         * errado. Repetir para sempre travaria a fila atrás de um envio que
         * nunca vai passar — e com ele todas as marcações seguintes.
         */
        if (e.status >= 400 && e.status < 500) {
          itens.shift();
          gravar();
          ultimoErro = e.message;
          avisar();
          continue;
        }
        t.tentativas = (t.tentativas ?? 0) + 1;
        ultimoErro = e.message;
        gravar();
        rodando = false;
        avisar();
        const espera = ESPERAS[Math.min(t.tentativas - 1, ESPERAS.length - 1)];
        clearTimeout(timer);
        timer = setTimeout(girar, espera);
        return;
      }
    }

    rodando = false;
    avisar();
  }

  addEventListener('online', () => { clearTimeout(timer); girar(); });
  addEventListener('offline', avisar);

  /*
   * Sair com fila cheia perde trabalho. O navegador só deixa pedir confirmação
   * de um jeito (mensagem própria é ignorada há anos), e é o suficiente: o
   * ponto é o técnico não fechar a aba achando que já salvou.
   */
  addEventListener('beforeunload', (e) => {
    if (itens.length) { e.preventDefault(); e.returnValue = ''; }
  });

  return {
    /** Enfileira substituindo o envio anterior do mesmo alvo. */
    push({ chave, caminho, metodo = 'POST', corpo = null }) {
      const j = itens.findIndex((x) => x.chave === chave);
      const novo = { chave, caminho, metodo, corpo, tentativas: 0 };
      if (j >= 0) itens[j] = novo;
      else itens.push(novo);
      gravar();
      avisar();
      girar();
    },
    estado: () => ({
      pendentes: itens.length,
      enviando: rodando,
      online: navigator.onLine,
      erro: ultimoErro,
    }),
    /** Tenta agora — o botão "tentar de novo" da barra de estado. */
    empurrar() { clearTimeout(timer); girar(); },
    /** Espera a fila esvaziar. Usado antes de concluir a vistoria. */
    async drenar(limiteMs = 15000) {
      const fim = Date.now() + limiteMs;
      this.empurrar();
      while (itens.length && Date.now() < fim) {
        await new Promise((r) => setTimeout(r, 250));
      }
      return itens.length === 0;
    },
  };
}
