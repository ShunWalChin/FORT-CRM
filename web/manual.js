/**
 * Manual do sistema — tutorial embutido.
 *
 * Fica dentro do próprio CRM, e não num PDF à parte, por um motivo prático: o
 * manual que mora longe do sistema não é lido. Aqui cada seção tem um botão que
 * abre a tela descrita, então ler e experimentar são o mesmo gesto.
 *
 * A linguagem é deliberadamente direta. Quem vai usar isto atende balcão de
 * oficina e embala queijo — não tem paciência para jargão, e não precisa ter.
 * Os termos técnicos aparecem, mas sempre explicados na primeira vez.
 */

/** Cada tela do sistema, explicada na mesma estrutura de quatro perguntas. */
export const TELAS = [
  {
    id: 'inicio',
    nome: 'Início',
    rota: '#/inicio',
    destaque: true,
    oQueE:
      'A primeira tela depois de entrar. Ela não mostra números — ela mostra o que fazer.',
    paraQue:
      'Responder a pergunta de quem abre o sistema pela primeira vez: "o que eu faço aqui?". '
      + 'Um menu com dezessete itens lista as telas, mas não diz por onde começar nem onde '
      + 'está o trabalho de hoje.',
    comoUsar: [
      'O botão grande no topo é a fila do dia, com o número de pessoas esperando. É a razão de o sistema existir, e por isso ocupa a largura toda.',
      'Cada botão é nomeado pelo que você quer FAZER — "Achar um cliente", e não "Clientes".',
      'No botão de clientes há um campo de busca embutido: com o cliente no balcão, digite o nome ali e tecle Enter para cair direto na lista filtrada.',
      'Os blocos mudam conforme a empresa ativa: a oficina mostra frota e ordens de serviço, a fazenda e a loja mostram pedidos e catálogo.',
      'Quem dirige vê também Conversões, Central do grupo e Auditoria. Quem atende não vê — são telas de mesa.',
    ],
    observar:
      'Os números nos botões são de verdade e mudam sozinhos. Se "pessoas esperando" está em '
      + 'zero, ou todo mundo já foi contatado hoje, ou os gatilhos estão desligados — vale '
      + 'conferir em "Gatilhos da régua" antes de concluir que não há trabalho.',
  },
  {
    id: 'painel',
    nome: 'Painel',
    rota: '#/painel',
    oQueE: 'A primeira tela depois de entrar. Um retrato da empresa que está ativa no momento.',
    paraQue:
      'Responder, em dez segundos, três perguntas: quantas pessoas eu preciso contatar hoje, '
      + 'como está minha base e quanto entrou de dinheiro no último mês.',
    comoUsar: [
      'O número grande e colorido no primeiro quadro é a fila da régua — quantos clientes o sistema separou para hoje.',
      'Clique em "Ver a fila de hoje" para ir direto ao trabalho.',
      'A barra de consentimento LGPD mostra que percentual da base pode receber mensagem automática. Abaixo de 90% é sinal de que falta coletar autorização.',
      'A tabela "O que dispara hoje" abre a fila por motivo — dá para ver se o dia é de revisão, de recompra ou de cobrança de orçamento.',
    ],
    observar:
      'O quadro "Ambíguas (unknown)" precisa ficar em zero. Se subir, tem mensagem que talvez '
      + 'tenha saído e talvez não — e alguém precisa conferir manualmente. Nunca deixe dormir.',
  },
  {
    id: 'regua',
    nome: 'Régua de contato',
    rota: '#/regua',
    destaque: true,
    oQueE:
      'A lista de quem falar hoje, montada pelo sistema sozinho, com a mensagem já escrita '
      + 'e o motivo à vista.',
    paraQue:
      'Resolver o problema mais caro de qualquer negócio de recorrência: o cliente que precisava '
      + 'voltar, ninguém lembrou de chamar, e ele foi no concorrente.',
    comoUsar: [
      'Cada linha é um cliente. À esquerda, quem é e por que apareceu. No meio, a mensagem pronta. À direita, a decisão do compliance.',
      'A mensagem é um campo de texto: ajuste a frase à vontade antes de mandar. Editar já marca a linha para envio.',
      '"Abrir no WhatsApp" abre a conversa com o texto pronto — inclusive o que você acabou de ajustar.',
      '"Copiar texto" leva a mensagem para a área de transferência.',
      'Marque as linhas e clique em "Disparar selecionados" para registrar no sistema.',
      'As linhas em cinza tracejado estão bloqueadas e não podem ser marcadas. O motivo aparece à direita.',
      '"Ver ficha" abre o histórico completo do cliente sem sair da fila.',
      '"Adiar" tira a linha da fila por 1, 3, 7 ou 30 dias — para o caso de "esse eu falo semana que vem". O cliente volta sozinho na data.',
      'Os adiados aparecem numa faixa no topo da fila, com a data de volta e um botão "Trazer de volta". Eles nunca somem em silêncio.',
    ],
    observar:
      'Leia os bloqueados. Eles não são erro — são o sistema recusando enviar. Um cliente sem '
      + 'consentimento, outro que pediu descadastro, outro que já recebeu essa mesma mensagem '
      + 'faz pouco tempo. É essa recusa que protege o número de WhatsApp da empresa. '
      + 'E o texto que você editar volta a passar por essa mesma checagem — se ele introduzir '
      + 'algo proibido, o envio é recusado e o sistema avisa. '
      + 'Adiar é por cliente E por motivo: adiar a revisão de um caminhão não silencia a '
      + 'cobrança de orçamento do mesmo cliente — são conversas diferentes.',
  },
  {
    id: 'clientes',
    nome: 'Clientes',
    rota: '#/clientes',
    oQueE: 'A base única do grupo. Toda pessoa ou empresa que já falou com o negócio.',
    paraQue: 'Ter um lugar só onde o cliente existe, com todo o histórico junto.',
    comoUsar: [
      'A busca aceita nome, telefone ou e-mail e filtra enquanto você digita.',
      'Clique em qualquer linha para abrir a ficha: dados, veículos, ordens de serviço, pedidos e linha do tempo.',
      'Os dados de contato são editáveis ali mesmo — telefone errado, e-mail novo, mudou de cidade. Clique em "Salvar alterações".',
      '"Novo cliente" cadastra à mão. Se o telefone já existir, o sistema recusa e mostra quem é.',
      'Na ficha, "Registrar descadastro" tira o contato de todas as réguas, para sempre.',
    ],
    observar:
      'A etiqueta de LGPD em cada linha. "Consentido" entra na régua; "sem consent." fica na base '
      + 'mas não recebe automação; "descadastrado" não recebe nada, nunca.',
  },
  {
    id: 'pipeline',
    nome: 'Pipeline',
    rota: '#/pipeline',
    oQueE: 'O quadro de oportunidades em aberto, em colunas por etapa da negociação.',
    paraQue: 'Ver quanto dinheiro está em jogo e em que pé está cada conversa.',
    comoUsar: [
      'Arraste o cartão de uma coluna para outra para mudar a etapa.',
      'No celular — ou se preferir — use o seletor no pé de cada cartão. Faz a mesma coisa e funciona no dedo.',
      'O valor no topo de cada coluna é a soma daquela etapa.',
      'Ao mover para "Perdido", o sistema pede o motivo — e não deixa passar sem.',
      'Mover para Qualificado, Orçamento ou Ganho gera um evento de conversão; o sistema avisa quando isso acontece.',
    ],
    observar:
      'O motivo da perda é o dado mais valioso da tela. Depois de trinta perdas registradas, '
      + 'dá para saber se o problema é preço, prazo ou falta de peça — e aí dá para corrigir.',
  },
  {
    id: 'frota',
    nome: 'Frota e veículos',
    rota: '#/frota',
    empresas: ['MP'],
    oQueE: 'O cadastro de todo veículo que passou pela oficina, com a previsão da próxima revisão.',
    paraQue:
      'Na injeção diesel a chave do relacionamento não é o nome do cliente — é a placa. '
      + 'É o veículo que tem quilometragem, sistema de injeção e prazo de revisão.',
    comoUsar: [
      'A coluna "Próxima revisão" traz a estimativa em dias, calculada pela média de rodagem entre passagens.',
      'Verde é folga, amarelo é perto, vermelho já venceu.',
      'Clique na linha para abrir a ficha do responsável pelo veículo.',
    ],
    observar:
      'Veículos marcados "sem projeção" não têm média de rodagem registrada. O sistema prefere '
      + 'não avisar a avisar errado — mas cada um deles é um lembrete que deixou de sair. '
      + 'Atualizar o KM na visita resolve.',
  },
  {
    id: 'ordens',
    nome: 'Ordens de serviço e laudo',
    rota: '#/ordens',
    empresas: ['MP'],
    oQueE: 'O histórico técnico de cada serviço: componente, bancada, pressão medida e garantia.',
    paraQue:
      'Provar o que foi feito. É daqui que sai o laudo digital de bancada, o documento que o '
      + 'cliente leva para casa.',
    comoUsar: [
      'Ordens abertas mostram o botão "Concluir". Ao concluir, o sistema pergunta a pressão medida na bancada.',
      'Ordens concluídas mostram o botão "Laudo", que abre o documento numa aba nova.',
      'No laudo, "Salvar como PDF" usa a impressão do navegador — é o arquivo que vai para o WhatsApp do cliente.',
    ],
    observar:
      'O laudo elimina a pergunta mais cara do setor: "será que trocaram mesmo?". Serve tanto '
      + 'para fechar venda quanto para se defender de reclamação injusta.',
  },
  {
    id: 'pedidos',
    nome: 'Pedidos e recompra',
    rota: '#/pedidos',
    empresas: ['AF', 'FT'],
    oQueE: 'Os pedidos, com o ciclo de recompra de cada produto.',
    paraQue:
      'Queijo artesanal é consumo que se repete, mas costuma ser vendido como compra única. '
      + 'Aqui cada pedido já agenda a próxima conversa.',
    comoUsar: [
      'A coluna "Ciclo" é de quantos em quantos dias aquele produto costuma acabar.',
      'A coluna "Próximo contato" mostra quando o cliente entra na régua de recompra.',
      'Clique na linha para abrir a ficha e ver todo o histórico de compras.',
    ],
    observar:
      'Clientes de revenda têm ticket muito maior e conversa diferente. Eles aparecem com o '
      + 'perfil "Revenda" e têm gatilho próprio — não trate lojista como consumidor final.',
  },
  {
    id: 'catalogo',
    nome: 'Catálogo',
    rota: '#/catalogo',
    oQueE: 'A tabela de serviços e produtos, com preço e ciclo de recompra.',
    paraQue:
      'Servir de referência de preço e alimentar a régua: é o ciclo cadastrado aqui que diz '
      + 'quando falar de novo com quem comprou.',
    comoUsar: ['Consulta e conferência. A edição de itens entra na próxima versão.'],
    observar: 'Ciclo em branco significa item que não gera recompra automática.',
  },
  {
    id: 'canais',
    nome: 'Canais de entrada',
    rota: '#/canais',
    oQueE:
      'O mapa de por onde o cliente desta empresa chega — e quanto de tudo isso dá para medir.',
    paraQue:
      'Responder a pergunta que decide verba: "de onde vêm meus clientes?". E, antes dela, '
      + 'uma pergunta mais desconfortável: quanto do faturamento é INVISÍVEL para o anúncio '
      + 'que o gerou.',
    comoUsar: [
      'O primeiro número é a cobertura atribuível: quantos clientes chegaram por um canal que carrega parâmetro de clique.',
      'A tabela lista todos os canais desta empresa — e só desta. Oficina tem guincho; fazenda tem feira e empório; loja de tintas tem pintor e construtora.',
      'A coluna "Como entra" é a mais acionável: "Porta pública" já entra sozinho; "Digitado" depende de alguém cadastrar; "Falta conector" é integração que ainda não existe.',
      'Em "Porta pública de captação", clique em "Copiar formulário pronto" e cole no site da empresa. Ele já captura gclid, fbclid e UTMs.',
      '"Enviar um lead de teste" prova que a porta funciona sem precisar publicar nada.',
    ],
    observar:
      'Cobertura baixa NÃO é defeito do sistema. Balcão, telefone, guincho e indicação não '
      + 'carregam parâmetro de clique e nunca vão carregar. Nesses canais a única atribuição '
      + 'possível é perguntar ao cliente como ele chegou — e a pergunta está no fim da tela. '
      + 'Sem ela, a campanha que de fato trouxe gente aparece com retorno zero e é a primeira '
      + 'a ser cortada.',
  },
  {
    id: 'grupo',
    nome: 'Painel consolidado',
    rota: '#/grupo',
    oQueE: 'As três empresas somadas, lado a lado, cada número vindo do seu próprio banco.',
    paraQue: 'Enxergar o grupo inteiro sem misturar a operação de cada negócio.',
    comoUsar: [
      'A tabela mostra cada empresa em sua linha e o consolidado nos quadros de cima.',
      'Só aparece para quem tem acesso a mais de uma empresa.',
      'Empresa cujo sistema estiver fora do ar aparece declarada como indisponível, nunca some da conta em silêncio.',
    ],
    observar:
      'O aviso do "motivo declarado" no topo não é decoração. Toda leitura que atravessa a '
      + 'fronteira entre empresas fica registrada na auditoria, com a justificativa.',
  },
  {
    id: 'atribuicao',
    nome: 'Origem dos leads',
    rota: '#/atribuicao',
    oQueE: 'De qual anúncio, campanha e plataforma cada cliente veio.',
    paraQue:
      'Sem guardar o identificador do clique no momento da entrada, não há como devolver a '
      + 'venda ao Google e à Meta depois — e sem essa devolução, o anúncio otimiza para o '
      + 'formulário preenchido em vez do cliente que fecha.',
    comoUsar: [
      'Os quadros de cima mostram quantos leads vieram de cada plataforma.',
      'A tabela por campanha diz qual anúncio está trazendo gente.',
      'A lista traz o identificador do clique guardado para cada contato.',
    ],
    observar:
      'Contato sem consentimento aparece com a etiqueta amarela. Ele fica na base e no funil, '
      + 'mas a conversão dele é bloqueada antes de sair — nem o dado embaralhado pode ir.',
  },
  {
    id: 'conversoes',
    nome: 'Conversões offline',
    rota: '#/conversoes',
    destaque: true,
    oQueE: 'A fila do que precisa voltar para o Google Ads e para a Meta.',
    paraQue:
      'A plataforma de anúncio enxerga só até o formulário. Ela não sabe se aquele lead virou '
      + 'orçamento, sumiu ou comprou oito mil reais. Contar isso a ela é o que faz a verba parar '
      + 'de perseguir curioso.',
    comoUsar: [
      'Mova uma oportunidade para Qualificado, Orçamento ou Ganho no Pipeline.',
      'Volte aqui e clique em Processar fila.',
      'Cada conversão vira duas — uma para o Google, outra para a Meta.',
      'O botão "Ver payload" mostra exatamente o que sairia para cada plataforma.',
    ],
    observar:
      'Em modo de demonstração nada é enviado, mas o conteúdo é montado do mesmo jeito. É ele '
      + 'que denuncia um campo faltando antes de a conta estar ligada — e que prova que nenhum '
      + 'e-mail ou telefone viaja em claro.',
  },
  {
    id: 'central',
    nome: 'Central do grupo',
    rota: '#/central',
    oQueE: 'Todo lead de todas as empresas, numa tela só.',
    paraQue:
      'As três empresas trabalham separadas, cada uma no seu sistema e no seu banco. O dono, '
      + 'às vezes, precisa ver tudo junto — e é só para isso que a central existe.',
    comoUsar: [
      'Os filtros permitem olhar uma empresa por vez ou todas juntas.',
      'O filtro de origem separa quem veio de anúncio de quem veio sozinho.',
      '"Sincronizar agora" puxa o que mudou nas instâncias.',
    ],
    observar:
      'A central é cópia para leitura, nunca a verdade. Se ela discordar de uma empresa, a '
      + 'empresa está certa e a central está desatualizada — por isso a data da última '
      + 'sincronização fica sempre à vista.',
  },
  {
    id: 'gatilhos',
    nome: 'Gatilhos da régua',
    rota: '#/gatilhos',
    oQueE: 'Os doze motivos pelos quais o sistema decide falar com alguém.',
    paraQue: 'Ajustar o texto das mensagens e ligar ou desligar cada motivo.',
    comoUsar: [
      'Cada cartão traz a regra (quando dispara), o cooldown (quanto tempo espera para repetir) e o texto.',
      'O botão "Ligar/Desligar" tira o gatilho de circulação sem apagar nada.',
      'No texto, as palavras entre chaves duplas são preenchidas na hora do envio com os dados do cliente.',
    ],
    observar:
      'A regra é do sistema; o texto é seu. Dá para reescrever qualquer mensagem sem mexer em '
      + 'programação — e é isso que deixa a comunicação com a cara do negócio.',
  },
  {
    id: 'disparos',
    nome: 'Histórico de disparos',
    rota: '#/disparos',
    oQueE: 'Tudo que a régua já tentou enviar, com o resultado de cada tentativa.',
    paraQue: 'Saber o que saiu, o que foi bloqueado e o que ficou em dúvida.',
    comoUsar: [
      'A coluna "Status" tem cinco valores possíveis, explicados no glossário abaixo.',
      'A coluna "Motivo" diz por que uma mensagem foi bloqueada.',
    ],
    observar:
      'Qualquer linha com status "unknown" precisa de olho humano no mesmo dia. É uma mensagem '
      + 'que pode ter chegado ao cliente ou não, e o sistema se recusa a chutar.',
  },
  {
    id: 'auditoria',
    nome: 'Auditoria',
    rota: '#/auditoria',
    oQueE: 'O registro de tudo que aconteceu no sistema, em ordem e encadeado.',
    paraQue:
      'Poder provar depois quem fez o quê e quando — para o cliente, para a lei e para uma '
      + 'eventual auditoria contábil.',
    comoUsar: [
      'A faixa no topo diz se a cadeia está íntegra.',
      'Cada linha carrega um código (hash) que depende do conteúdo da linha anterior.',
    ],
    observar:
      'Alterar um registro antigo quebraria a cadeia inteira e a tela acusaria na hora. '
      + 'Detectar não é o mesmo que impedir — está explicado na própria tela.',
  },
  {
    id: 'importar',
    nome: 'Importar base',
    rota: '#/importar',
    oQueE: 'A porta de entrada da base de clientes que já existe, em planilha.',
    paraQue: 'Trazer para o sistema o que hoje está espalhado em caderno, Excel e WhatsApp.',
    comoUsar: [
      'Abra sua planilha, copie tudo (com a primeira linha de títulos) e cole no campo.',
      'Colunas reconhecidas: nome, telefone, email, cidade e consentimento.',
      'Telefone repetido é ignorado — a base não duplica.',
    ],
    observar:
      'Quem vier sem consentimento marcado entra na base como histórico, mas fica fora da régua. '
      + 'É proposital: régua não é lugar de lista comprada.',
  },
];

/** Termos que aparecem na tela e não são óbvios para quem não é da área. */
export const GLOSSARIO = [
  {
    termo: 'Click-to-WhatsApp (CTWA)',
    texto:
      'O anúncio que ABRE A CONVERSA em vez de abrir uma página. Não passa por navegador '
      + 'nenhum, então não tem fbclid: o identificador é o ctwa_clid, que chega no webhook da '
      + 'PRIMEIRA mensagem e em nenhum outro lugar. Perder esse webhook é perder a atribuição '
      + 'daquele lead para sempre — não existe API para recuperar histórico de webhook.',
  },
  {
    termo: 'Local da conversão (action_source)',
    texto:
      'Onde a conversão realmente aconteceu, que não é a mesma coisa que a origem do lead. '
      + 'O cliente pode chegar pelo WhatsApp e fechar na loja. Rotular a venda como "no chat" '
      + 'porque o lead veio do chat é reportar coisa errada para quem decide a verba, e o '
      + 'sistema separa os dois de propósito.',
  },
  {
    termo: 'Janela de 7 dias',
    texto:
      'A Meta recusa conversão com mais de 7 dias. O sistema barra antes de tentar enviar: '
      + 'um evento velho que falha na plataforma vira retentativa infinita, e o motivo real '
      + 'fica escondido atrás de um erro genérico.',
  },
  {
    termo: 'Canal atribuível',
    texto:
      'Canal que carrega parâmetro de clique (gclid do Google, fbclid da Meta). Só esses fecham '
      + 'o ciclo com a plataforma de anúncio. Formulário do site e anúncio que abre o WhatsApp '
      + 'são atribuíveis; balcão, telefone, guincho e indicação não são, e nenhuma configuração '
      + 'muda isso. WhatsApp orgânico também não é — e esse é o engano mais comum, porque o '
      + 'número é o mesmo que o anúncio usa. Só o clique distingue um do outro.',
  },
  {
    termo: 'Cobertura atribuível',
    texto:
      'A fatia da base que chegou por canal atribuível. É o teto do que a conversão offline '
      + 'consegue devolver ao Google e à Meta: com 30% de cobertura, 70% do faturamento é '
      + 'invisível para o anúncio, por mais correto que esteja o resto do sistema.',
  },
  {
    termo: 'Chave de captação',
    texto:
      'O endereço da porta pública de cada empresa, para colar no formulário do site. Ela só '
      + 'ROTEIA: não lê nada, não lista nada e não vira sessão. Por isso pode ficar num HTML '
      + 'público — que é exatamente onde ela precisa estar. Vazar uma chave permite mandar lead '
      + 'falso para a triagem; nunca ler a base.',
  },
  {
    termo: 'Triagem da Central',
    texto:
      'Todo lead que entra de fora cai primeiro na Central, nunca direto na base da empresa. '
      + 'Assim nenhuma instância fica exposta a tráfego externo, e nada entra em produção sem '
      + 'passar por conferência.',
  },
  {
    termo: 'Empresa ativa (tenant)',
    texto:
      'O sistema guarda as duas empresas na mesma base, mas totalmente separadas. A empresa '
      + 'escolhida na lateral define tudo o que você vê. A cor da tela muda junto — é o aviso '
      + 'visual para ninguém cadastrar na empresa errada por distração.',
  },
  {
    termo: 'Consentimento LGPD',
    texto:
      'A autorização do cliente para receber mensagem. Sem ela registrada, o contato fica na base '
      + 'mas nenhuma automação o alcança. A lei brasileira exige, e o sistema aplica sozinho.',
  },
  {
    termo: 'Descadastro (opt-out)',
    texto:
      'Quando o cliente pede para não receber mais. Bloqueia qualquer envio automático, sem '
      + 'exceção e sem prazo. Toda mensagem automática termina com "Responda PARAR" justamente '
      + 'para tornar isso fácil.',
  },
  {
    termo: 'Janela de 24 horas',
    texto:
      'O WhatsApp só considera normal a empresa responder quem falou com ela recentemente. '
      + 'Passadas 24 horas do último contato do cliente, mandar mensagem vira abordagem fria — '
      + 'e é assim que número comercial é denunciado e bloqueado. O sistema respeita a janela.',
  },
  {
    termo: 'Cooldown',
    texto:
      'O tempo mínimo entre duas mensagens do mesmo motivo para o mesmo cliente. Impede que a '
      + 'pessoa receba três vezes o mesmo aviso de revisão na mesma semana.',
  },
  {
    termo: 'Compliance',
    texto:
      'O conjunto de regras que decide se uma mensagem pode sair. Roda no instante do envio, '
      + 'nunca no agendamento — porque alguém pode pedir descadastro entre uma coisa e outra.',
  },
  {
    termo: 'Status do disparo',
    texto:
      '"sent" saiu e foi confirmado. "blocked" o compliance recusou, nada saiu. "failed" a '
      + 'plataforma recusou de forma clara e dá para tentar de novo. "claimed" está em andamento. '
      + '"unknown" a resposta foi ambígua: pode ter chegado ao cliente ou não, e por isso o '
      + 'sistema não repete sozinho — chama um humano.',
  },
  {
    termo: 'Por que "unknown" existe',
    texto:
      'Uma mensagem atrasada se explica ao cliente. Uma mensagem duplicada não se desfaz. Quando '
      + 'há dúvida, o sistema erra para o lado de não repetir.',
  },
  {
    termo: 'Projeção de revisão',
    texto:
      'O caminhão não avisa quando chega nos 20.000 km. O sistema calcula: pega a quilometragem '
      + 'da última visita, a média que aquele veículo roda por mês, e estima a data. Sem média '
      + 'registrada, ele não estima — prefere ficar em branco a errar.',
  },
  {
    termo: 'Cadeia de auditoria',
    texto:
      'Cada registro guarda um código calculado a partir do registro anterior. Mudar qualquer '
      + 'linha antiga quebra todos os códigos seguintes, e a tela de auditoria acusa.',
  },
  {
    termo: 'Instância',
    texto:
      'O sistema de UMA empresa, com o seu próprio banco de dados. Três empresas, três '
      + 'instâncias, três arquivos separados. Não é permissão que separa: o dado de uma '
      + 'simplesmente não está no arquivo da outra, e por isso nenhum erro de programação '
      + 'consegue misturar.',
  },
  {
    termo: 'Central do grupo',
    texto:
      'Uma quarta instância que só lê. Ela copia os leads das três empresas para que exista '
      + 'uma tela com tudo. Nada é criado nem alterado ali — se a central discordar de uma '
      + 'empresa, a empresa está certa.',
  },
  {
    termo: 'Parâmetro de clique',
    texto:
      'O código que o Google (gclid) e a Meta (fbclid) colam no endereço quando alguém clica '
      + 'no anúncio. É o que permite dizer a eles, semanas depois, que aquele clique virou '
      + 'venda. Se não for guardado na hora que a pessoa chega, some para sempre.',
  },
  {
    termo: 'Conversão offline',
    texto:
      'A notícia que mandamos de volta ao Google e à Meta contando o que aconteceu depois do '
      + 'clique: virou lead qualificado, virou orçamento, virou venda de tanto. É isso que '
      + 'ensina o anúncio a procurar mais gente parecida com quem compra.',
  },
  {
    termo: 'Dado embaralhado (hash)',
    texto:
      'E-mail e telefone nunca são enviados como estão. Viram um código irreversível de 64 '
      + 'caracteres, que a plataforma consegue comparar com o dela sem nunca ler o original.',
  },
  {
    termo: 'Modo demonstração',
    texto:
      'Enquanto estiver ligado, nenhuma mensagem chega a número real. Tudo é processado, '
      + 'registrado e auditado como se fosse — só o último passo não acontece.',
  },
];

/** Tarefas do dia a dia, na ordem em que aparecem na vida real. */
export const RECEITAS = [
  {
    titulo: 'Fazer o trabalho do dia',
    passos: [
      'Entre e confira o número da fila no Painel.',
      'Vá em Régua de contato.',
      'Leia as mensagens de cima para baixo — as mais urgentes vêm primeiro.',
      'Marque as que fazem sentido e clique em Disparar selecionados.',
      'Confira os bloqueados: alguns viram tarefa (coletar consentimento, por exemplo).',
    ],
  },
  {
    titulo: 'Ligar um anúncio Click-to-WhatsApp',
    passos: [
      'Abra "Canais de entrada" e vá até o bloco Click-to-WhatsApp.',
      'Copie o endereço do webhook mostrado ali.',
      'No app da Meta, aponte o webhook para esse endereço e assine o campo "messages".',
      'Defina FORTCRM_META_APP_SECRET e FORTCRM_WHATSAPP_VERIFY_TOKEN no servidor — sem o segredo a porta recusa tudo, de propósito.',
      'Clique no anúncio pelo celular e mande a primeira mensagem.',
      'Volte à tela: o contador de "vindas de anúncio" tem de subir, e o lead aparece na Central já roteado para a empresa dona do número.',
      'Se aparecer aviso de conversa sem ctwa_clid, não é erro: posicionamento em Status do WhatsApp chega assim. O sistema registra a ausência em vez de inventar um clique.',
    ],
  },
  {
    titulo: 'Ligar o formulário do site a este CRM',
    passos: [
      'Abra "Canais de entrada" com a empresa certa selecionada na lateral — a chave é por empresa.',
      'Clique em "Enviar um lead de teste" e confirme que aparece um protocolo.',
      'Clique em "Copiar formulário pronto".',
      'Cole no site, na página onde o lead deve ser capturado.',
      'Faça um envio real pelo site e confira em "Central do grupo" que ele chegou.',
      'Se chegou sem gclid nem UTM, o problema está no link do anúncio, não aqui — o sistema avisa quando o lead não tem sinal nenhum.',
    ],
  },
  {
    titulo: 'Descobrir de onde vêm os clientes',
    passos: [
      'Abra "Canais de entrada".',
      'Leia a cobertura atribuível: é quanto da base dá para ligar a um anúncio.',
      'Na tabela, olhe a coluna "Como entra" — tudo que estiver como "Digitado" depende de alguém lembrar de cadastrar.',
      'Para o resto, use a pergunta do fim da página no atendimento: é a única atribuição possível em balcão e telefone.',
      'Depois, em "Origem dos leads", veja o que já tem parâmetro de clique guardado.',
    ],
  },
  {
    titulo: 'Trocar o tema de cores',
    passos: [
      'No rodapé da lateral esquerda há cinco bolinhas.',
      'Passe o mouse para ver o nome e para que serve cada tema.',
      'Clique na que quiser — muda na hora e fica salva neste navegador.',
      'No balcão, sob luz forte, "Oficina" costuma ser o mais legível; para quem enxerga mal ou vai imprimir, use "Papel"; no plantão de madrugada, "Meia-noite" cansa menos a vista.',
      'A cor do acento continua sendo a da empresa em todos eles — é o aviso de canto de olho de qual empresa está na tela.',
    ],
  },
  {
    titulo: 'Achar um cliente, uma OS ou uma placa',
    passos: [
      'Aperte Ctrl+K — ou a barra "/", ou o campo "Buscar" na lateral. Funciona de qualquer tela.',
      'Digite o que você tem na mão: parte do nome, o telefone, a placa do veículo ou o número da OS.',
      'Não precisa de acento nem de pontuação: "antonio" acha Antônio, e "(38) 99811-2233" acha o mesmo que 5538998112233.',
      'Use as setas para escolher e Enter para abrir. Cliente abre a ficha; OS, pedido e oportunidade abrem a tela com a linha acesa.',
      'Digitar o nome de uma tela também funciona — e por apelido: "cobrança" leva à régua, "meta" leva a Conversões.',
      'Se não achar nada, a busca diz em que empresa você está e oferece procurar nas outras. Cada empresa tem banco próprio — a busca não atravessa sozinha.',
    ],
  },
  {
    titulo: 'Adiar um contato para depois',
    passos: [
      'Na Régua de contato, clique em "Adiar" na linha do cliente.',
      'Escolha o prazo: amanhã, em 3 dias, semana que vem ou em um mês.',
      'A linha sai da fila e aparece na faixa do topo, com a data em que volta.',
      'Mudou de ideia? "Trazer de volta" na mesma faixa devolve o contato à fila na hora.',
      'Se a fila ficar vazia só por causa de adiamentos, a tela diz isso com todas as letras — e não "não há trabalho hoje".',
    ],
  },
  {
    titulo: 'Atender alguém que está no balcão agora',
    passos: [
      'Na tela de Início, use o campo de busca dentro do botão "Achar um cliente".',
      'Digite o nome ou o telefone e tecle Enter.',
      'A lista já abre filtrada; clique na linha para abrir a ficha.',
      'A ficha traz histórico, veículos, pedidos e o que já foi conversado — e os dados de contato são editáveis ali mesmo.',
      'O endereço da ficha é compartilhável: copie a URL e mande para um colega.',
    ],
  },
  {
    titulo: 'Trabalhar a fila pelo celular',
    passos: [
      'Abra o sistema no telefone: ele já abre na fila de hoje.',
      'A barra de baixo mostra quantos estão liberados no contador de "Hoje".',
      'Role a lista. Cada item traz quem é, por que apareceu e a mensagem em duas linhas.',
      'Toque na mensagem se quiser ajustar — o campo cresce enquanto você escreve.',
      'Toque em "Abrir no WhatsApp": a conversa abre com o texto pronto.',
      'Volte ao sistema, marque o item e toque em "Disparar selecionados" para registrar o contato.',
    ],
  },
  {
    titulo: 'Mandar a mensagem de fato, hoje',
    passos: [
      'Na Régua de contato, leia o motivo e a mensagem.',
      'Ajuste a frase se quiser — você conhece o cliente melhor que o sistema.',
      'Clique em "Abrir no WhatsApp": a conversa abre com o texto já dentro.',
      'Confira e envie no WhatsApp.',
      'Volte e clique em "Disparar selecionados" para o sistema registrar que aquele contato foi feito — é isso que aciona o cooldown e evita mandar de novo.',
    ],
  },
  {
    titulo: 'Corrigir um dado errado do cliente',
    passos: [
      'Vá em Clientes e abra a ficha.',
      'Corrija telefone, e-mail, cidade ou perfil no formulário.',
      'Clique em "Salvar alterações".',
      'Telefone certo importa: é por ele que o botão do WhatsApp abre a conversa.',
    ],
  },
  {
    titulo: 'Atender alguém que chegou agora',
    passos: [
      'Vá em Clientes e busque pelo telefone.',
      'Se existir, abra a ficha e veja o histórico antes de falar.',
      'Se não existir, clique em Novo cliente e marque o consentimento se a pessoa autorizar.',
    ],
  },
  {
    titulo: 'Entregar um serviço com laudo',
    passos: [
      'Vá em Ordens de serviço.',
      'Ache a OS e clique em Concluir.',
      'Informe a pressão medida na bancada.',
      'Clique em Laudo, depois em Salvar como PDF.',
      'Envie o arquivo ao cliente pelo WhatsApp.',
    ],
  },
  {
    titulo: 'Trazer a base que já existe',
    passos: [
      'Organize a planilha com as colunas nome, telefone, email, cidade e consentimento.',
      'Vá em Importar base e cole tudo.',
      'Confira o aviso de quantos entraram sem consentimento — esses ficam fora da régua.',
    ],
  },
  {
    titulo: 'Mudar o texto de uma mensagem automática',
    passos: [
      'Vá em Gatilhos da régua.',
      'Ache o gatilho e leia o texto atual.',
      'As palavras entre chaves são preenchidas sozinhas — mantenha as que quiser usar.',
      'Volte à Régua para ver o texto já preenchido com dados reais antes de disparar.',
    ],
  },
  {
    titulo: 'Preparar o sistema para outra demonstração',
    passos: [
      'Clique em Reancorar no tempo, na lateral. É o primeiro a tentar.',
      'A história inteira desliza para frente e a fila volta a encher — sem apagar nada do que já foi feito.',
      'Use Recarregar demonstração só quando quiser realmente zerar tudo.',
      'O painel avisa sozinho quando a demonstração passa de 12 horas.',
    ],
  },
];

/** O que o protótipo ainda não é. Fica no manual para ninguém prometer demais. */
export const LIMITES = [
  'O menu muda conforme o seu papel: quem atende vê as telas de operação; quem dirige vê também as de governança e aquisição.',
  'Nenhuma mensagem chega a número real: falta conectar o WhatsApp, que é etapa contratada à parte.',
  'A régua é calculada quando alguém abre a tela. Em produção, roda sozinha de madrugada.',
  'As senhas desta demonstração são simples e a base é fictícia — nenhum dado real de cliente está aqui.',
  'A porta pública de captação e o webhook de Click-to-WhatsApp já funcionam. WhatsApp orgânico, Instagram e Mercado Livre ainda dependem de conector — em "Canais de entrada" eles aparecem como "Falta conector".',
  'Os eventos de conversão são montados e auditados, mas não saem para a Meta nem para o Google enquanto DEMO_MODE estiver ligado.',
  'Não dá para cadastrar veículo, ordem de serviço ou item de catálogo pela interface — só clientes e oportunidades nascem por aqui.',
  'Edição de catálogo, metas, relatórios em PDF e aplicativo de celular estão na fila de evolução.',
];

/* ── Renderização ───────────────────────────────────────────────────────── */

const esc = (v) => String(v ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#39;');

export function manualHtml(codigoEmpresa) {
  const visiveis = TELAS.filter((t) => !t.empresas || t.empresas.includes(codigoEmpresa));

  return `
    <div class="cabeca">
      <div>
        <div class="kicker">// MANUAL DO SISTEMA</div>
        <h1 class="titulo">Como usar, do começo</h1>
        <p class="chamada">
          Um guia para quem nunca viu este sistema. Cada seção explica uma tela e tem um botão que
          abre a tela de verdade — leia um pedaço, experimente, volte.
        </p>
      </div>
    </div>

    <div class="manual">
      <nav class="manual-indice" id="manual-indice">
        <div class="rot">NESTE MANUAL</div>
        <a href="#inicio" data-ir="inicio">Como o sistema é organizado</a>
        <a href="#busca" data-ir="busca">Achar qualquer coisa</a>
        <a href="#telas" data-ir="telas">As telas, uma a uma</a>
        ${visiveis.map((t) => `<a class="sub" href="#tela-${t.id}" data-ir="tela-${t.id}">${esc(t.nome)}</a>`).join('')}
        <a href="#celular" data-ir="celular">No celular</a>
        <a href="#temas" data-ir="temas">Temas e acessibilidade</a>
        <a href="#receitas" data-ir="receitas">Como faço para…</a>
        <a href="#glossario" data-ir="glossario">Glossário</a>
        <a href="#limites" data-ir="limites">O que ainda não faz</a>
      </nav>

      <div class="manual-corpo">
        <section id="inicio">
          <h2 class="secao">Como o sistema é organizado</h2>
          <p class="manual-p">
            Este é um CRM de <strong>três empresas em três instâncias separadas</strong>: a
            oficina de injeção diesel, a fazenda de queijo e a loja de tintas. Cada uma tem o seu
            próprio banco de dados — não é uma divisão por permissão, é arquivo diferente. Quem
            atende o balcão da oficina não enxerga um pedido de queijo porque aquele dado não
            está no sistema que ele abriu.
          </p>
          <p class="manual-p">
            A empresa escolhida na lateral esquerda comanda tudo o que aparece na tela.
            <strong>Troque de empresa e a cor da interface muda junto</strong> — verde-azulado
            para a Minas Peças, vinho para a Agrofort, âmbar para a Fort Tintas. É um aviso de
            canto de olho: se a cor está errada, você está prestes a cadastrar no lugar errado.
            E quando quiser ver o grupo inteiro, existe a <strong>Central</strong>, que junta as
            três só para leitura.
          </p>
          <div class="aviso">
            <strong>O que o sistema faz de mais importante</strong> não é guardar cadastro — isso
            qualquer planilha faz. É <strong>avisar você de quem precisa ser chamado hoje</strong>,
            com a mensagem já escrita, e recusar o envio quando não pode enviar.
          </div>
          <p class="manual-p">
            O menu está agrupado por assunto: <strong>Operação</strong> é o dia a dia;
            <strong>Por empresa</strong> muda conforme o negócio ativo, porque oficina tem frota e
            fazenda tem pedido; <strong>Aquisição</strong> trata de origem e retorno de anúncio; e
            <strong>Grupo e governança</strong> é a visão de dono e o registro do que aconteceu.
          </p>
          <p class="manual-p">
            <strong>O menu muda conforme o seu papel.</strong> Quem atende o balcão vê as telas de
            operação; quem dirige vê também as de governança. Isso é organização de tela, e não
            segurança: quem digitar o endereço chega igual, e é o servidor que recusa.
          </p>
        </section>

        <section id="busca">
          <h2 class="secao">Achar qualquer coisa</h2>
          <p class="manual-p">
            <strong>Ctrl+K</strong> (ou a tecla <kbd>/</kbd>, ou o campo <em>Buscar</em> na
            lateral) abre uma busca única, de qualquer tela. Ela procura o que você tem na mão:
            parte do nome, o telefone, a placa do veículo, o número da ordem de serviço, o SKU
            do catálogo — e também o nome das telas.
          </p>
          <p class="manual-p">
            <strong>Não precisa de acento nem de pontuação.</strong> Digitar
            <code>antonio</code> acha <em>Antônio</em>, e <code>(38) 99811-2233</code> acha o
            mesmo cliente que <code>5538998112233</code>. Ninguém guarda telefone com o formato
            certo, e no celular ninguém digita circunflexo.
          </p>
          <p class="manual-p">
            <strong>As telas atendem por apelido.</strong> Quem quer a régua digita
            <em>cobrança</em> ou <em>whatsapp</em>; quem quer Conversões digita <em>meta</em>,
            <em>google</em> ou <em>campanha</em>. Buscar só pelo nome exato da tela ajuda apenas
            quem já sabia onde a coisa estava.
          </p>
          <p class="manual-p">
            Use <kbd>&uarr;</kbd> <kbd>&darr;</kbd> para escolher e <kbd>Enter</kbd> para abrir.
            Um cliente abre a ficha; uma OS, um pedido ou uma oportunidade abrem a tela com a
            linha acesa — sem obrigar você a procurar de novo, agora com os olhos.
          </p>
          <p class="manual-p">
            <strong>A busca não atravessa empresas.</strong> Cada uma tem banco próprio, e
            misturar clientes de duas na mesma lista seria justamente o que a separação existe
            para impedir. Quando não acha nada, a busca diz em qual empresa procurou e oferece
            procurar nas outras a que você tem acesso — a travessia acontece, mas é você quem
            decide fazê-la.
          </p>
        </section>

        <section id="telas">
          <h2 class="secao">As telas, uma a uma</h2>
          ${visiveis.map(secaoTela).join('')}
        </section>

        <section id="celular">
          <h2 class="secao">No celular</h2>
          <p class="manual-p">
            O sistema muda de forma no celular — não é a tela do computador
            encolhida. Quem atende de telefone na mão faz três coisas: olha a fila
            de hoje, acha um cliente e manda a mensagem. É isso que fica à mão.
          </p>
          <div class="tabela-caixa">
            <table>
              <thead><tr><th>O que muda</th><th>Por quê</th></tr></thead>
              <tbody>
                <tr>
                  <td class="forte">Barra embaixo da tela</td>
                  <td>Hoje, Clientes, Funil e Mais. O polegar alcança a base da tela; menu no alto custa dois toques para tudo.</td>
                </tr>
                <tr>
                  <td class="forte">Abre na fila, não no painel</td>
                  <td>A pergunta com o cliente na frente é “com quem eu falo agora”, não “como foi o mês”.</td>
                </tr>
                <tr>
                  <td class="forte">Tabela vira cartão</td>
                  <td>Sete colunas num aparelho de 375 px escondiam 593 px de conteúdo. Cada linha vira um cartão com três campos e um toque para ver o resto.</td>
                </tr>
                <tr>
                  <td class="forte">Mensagem em duas linhas</td>
                  <td>Toque no campo e ele cresce conforme você escreve. Se você editar, ele fica aberto — o texto ajustado não some de vista.</td>
                </tr>
                <tr>
                  <td class="forte">Ficha sobe de baixo</td>
                  <td>Ocupa a tela quase inteira, com uma alça no topo. Toque fora para fechar.</td>
                </tr>
                <tr>
                  <td class="forte">Funil desliza</td>
                  <td>Uma etapa por vez, arrastando de lado. Para mover um cartão, use o seletor no pé dele — arrastar e soltar não funciona no dedo.</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="aviso">
            <strong>Tablet fica no meio, de propósito.</strong> Deitado, ele ganha a
            barra de polegar mas mantém as tabelas — elas cabem ali. O sistema usa
            duas medidas diferentes porque são duas perguntas diferentes: se a
            lateral cabe ao lado do conteúdo, e se a tabela ainda é legível.
          </div>
          <p class="manual-p">
            Auditoria, Conversões offline e Importar base continuam acessíveis pelo
            botão <strong>Mais</strong>, mas são trabalho de mesa: têm muita coluna e
            muita leitura. No computador rendem mais.
          </p>
        </section>

        <section id="temas">
          <h2 class="secao">Temas e acessibilidade</h2>
          <p class="manual-p">
            A mesma tela é olhada em lugares muito diferentes: um balcão de peças sob luz
            fluorescente, uma varanda de fazenda ao sol e um plantão de guincho às três da
            manhã. Nenhuma paleta serve às três, e por isso existem <strong>cinco temas</strong>
            — nas bolinhas no rodapé da lateral.
          </p>
          <div class="tabela-caixa">
            <table>
              <thead><tr><th>Tema</th><th>Quando usar</th></tr></thead>
              <tbody>
                <tr><td class="forte">Cockpit</td><td>Escuro. O padrão — demonstração e uso noturno.</td></tr>
                <tr><td class="forte">Oficina</td><td>Claro industrial. Balcão sob luz forte, onde o tema escuro vira espelho.</td></tr>
                <tr><td class="forte">Cerrado</td><td>Claro quente. Tela vista sob sol.</td></tr>
                <tr><td class="forte">Papel</td><td>Contraste máximo, corpo em serifa e um ponto maior. Para vista cansada, sol direto e o que vai ser impresso.</td></tr>
                <tr><td class="forte">Meia-noite</td><td>Escuro quente, pouco azul. Plantão de madrugada.</td></tr>
              </tbody>
            </table>
          </div>
          <p class="manual-p">
            A escolha fica salva <strong>neste navegador</strong>, não na sua conta — trocar de
            máquina volta ao padrão. Em todos eles a <strong>cor do acento continua sendo a da
            empresa ativa</strong>: é o aviso de canto de olho contra cadastrar no lugar errado,
            e ele não se perde ao mudar de tema.
          </p>
          <div class="aviso ok">
            <strong>Contraste medido, não estimado.</strong> Nos cinco temas, todo texto fica
            acima de 4,5:1 contra o próprio fundo — o mínimo que a norma de acessibilidade exige
            para leitura. O menu inteiro funciona por teclado, com anel de foco visível, e o
            sistema respeita quem pediu menos animação no sistema operacional.
          </div>
        </section>

        <section id="receitas">
          <h2 class="secao">Como faço para…</h2>
          ${RECEITAS.map((r) => `
            <div class="cartao manual-receita">
              <h4>${esc(r.titulo)}</h4>
              <ol>${r.passos.map((p) => `<li>${esc(p)}</li>`).join('')}</ol>
            </div>`).join('')}
        </section>

        <section id="glossario">
          <h2 class="secao">Glossário</h2>
          <p class="manual-p">
            Termos que aparecem nas telas. Nenhum deles é decoração — todos mudam o que o sistema
            faz.
          </p>
          ${GLOSSARIO.map((g) => `
            <div class="manual-termo">
              <dt>${esc(g.termo)}</dt>
              <dd>${esc(g.texto)}</dd>
            </div>`).join('')}
        </section>

        <section id="limites">
          <h2 class="secao">O que ainda não faz</h2>
          <div class="aviso warn">
            Esta é uma versão de demonstração. Escrito aqui para que ninguém prometa ao cliente
            o que o sistema ainda não entrega.
          </div>
          <ul class="manual-lista">
            ${LIMITES.map((l) => `<li>${esc(l)}</li>`).join('')}
          </ul>
        </section>
      </div>
    </div>`;
}

function secaoTela(t) {
  return `
    <article class="manual-tela ${t.destaque ? 'destaque' : ''}" id="tela-${t.id}">
      <div class="manual-tela-topo">
        <h3>${esc(t.nome)}${t.destaque ? ' <span class="tag ac">a mais importante</span>' : ''}</h3>
        <button class="btn quiet sm" data-abrir="${esc(t.rota)}">Abrir esta tela →</button>
      </div>
      <div class="manual-campo"><span class="r">O QUE É</span><p>${esc(t.oQueE)}</p></div>
      <div class="manual-campo"><span class="r">PARA QUE SERVE</span><p>${esc(t.paraQue)}</p></div>
      <div class="manual-campo">
        <span class="r">COMO USAR</span>
        <ol>${t.comoUsar.map((p) => `<li>${esc(p)}</li>`).join('')}</ol>
      </div>
      <div class="manual-campo destaque-obs">
        <span class="r">O QUE OBSERVAR</span><p>${esc(t.observar)}</p>
      </div>
    </article>`;
}

/** Liga os botões depois que o HTML entrou na página. */
export function ligarManual(el, navegarPara) {
  el.querySelectorAll('[data-abrir]').forEach((b) => {
    b.onclick = () => navegarPara(b.dataset.abrir);
  });
  el.querySelectorAll('[data-ir]').forEach((a) => {
    a.onclick = (ev) => {
      ev.preventDefault();
      const alvo = el.querySelector(`#${CSS.escape(a.dataset.ir)}`);
      alvo?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
  });
}
