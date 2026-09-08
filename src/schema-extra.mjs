/**
 * Acréscimos de esquema da fase de federação e conversão offline.
 *
 * Ficam em arquivo separado do núcleo por serem de outra época do sistema:
 * `schema.mjs` descreve o CRM de uma empresa; aqui está o que só faz sentido
 * quando existem várias instâncias e quando o que acontece no funil precisa
 * voltar para as plataformas de anúncio.
 *
 * Tudo com `create ... if not exists` — uma instância que já existe em disco
 * recebe as tabelas novas sem recarga. Reaplicar não pode quebrar nem duplicar.
 */

export const SCHEMA_EXTRA_SQL = `
-- Fila de eventos ----------------------------------------------------------
-- Nenhum gatilho de banco faz efeito externo. Gatilho grava aqui; um worker
-- drena e executa, com tentativa, recuo e registro. Transação de banco
-- esperando rede é o modo clássico de travar o sistema inteiro sob carga.
create table if not exists event_log (
  id                   text primary key,
  empresa_id           text not null references empresas(id) on delete cascade,
  tipo                 text not null,
  entidade             text,
  entidade_id          text,
  payload              text not null default '{}',
  metadata             text not null default '{}',
  consumido_por        text not null default '[]',
  tentativas           integer not null default 0,
  status               text not null default 'pendente'
                       check (status in ('pendente','processando','concluido','morto')),
  proxima_tentativa_em text,
  criado_em            text not null
);
create index if not exists ix_event_log_pendente on event_log(status, proxima_tentativa_em);
create index if not exists ix_event_log_empresa on event_log(empresa_id, criado_em);

-- Atribuição de anúncio ----------------------------------------------------
-- Primeiro toque gravado UMA vez e nunca reescrito: a pessoa pode clicar em
-- outro anúncio meses depois, e isso não muda de onde ela veio originalmente,
-- que é o dado que explica a existência do relacionamento. O último toque
-- existe em paralelo, para quem quer medir o que fechou a venda.
create table if not exists atribuicoes (
  id             text primary key,
  empresa_id     text not null references empresas(id) on delete cascade,
  cliente_id     text not null references clientes(id) on delete cascade,
  toque          text not null default 'primeiro' check (toque in ('primeiro','ultimo')),
  plataforma     text check (plataforma in ('google_ads','meta_ads','organico','indicacao','direto')),
  gclid          text,
  gbraid         text,
  wbraid         text,
  fbclid         text,
  fbp            text,
  fbc            text,
  -- Click-to-WhatsApp. ctwa_clid e o identificador do clique quando o
  -- anuncio ABRE A CONVERSA em vez de abrir uma pagina: nao ha fbclid nem
  -- navegador envolvido. Vem no webhook da primeira mensagem e so ali.
  ctwa_clid      text,
  waba_id        text,
  source_ad_id   text,
  -- Anuncio que chegou SEM o clique (posicionamento em Status do WhatsApp e o
  -- caso conhecido). Coluna propria em vez de "ctwa_clid is null" porque os
  -- dois casos sao diferentes: aqui houve anuncio e faltou o identificador;
  -- nulo puro e conversa organica, que nunca teve anuncio nenhum.
  ctwa_clid_ausente integer not null default 0,
  utm_source     text,
  utm_medium     text,
  utm_campaign   text,
  utm_term       text,
  utm_content    text,
  pagina_entrada text,
  referrer       text,
  bruto          text not null default '{}',
  capturado_em   text not null
);
create unique index if not exists ux_atribuicao_toque
  on atribuicoes(empresa_id, cliente_id, toque);
create index if not exists ix_atribuicao_gclid on atribuicoes(empresa_id, gclid);

-- Identificadores em hash para correspondência avançada --------------------
-- E-mail e telefone nunca vão em claro para plataforma de anúncio. O hash é o
-- que elas aceitam, e guardar só o hash significa que um vazamento desta
-- tabela não devolve o contato original.
create table if not exists identificadores_hash (
  cliente_id       text primary key references clientes(id) on delete cascade,
  empresa_id       text not null references empresas(id) on delete cascade,
  email_sha256     text,
  -- As duas formas do telefone, porque as plataformas divergem: o Google pede
  -- E.164 COM o '+', a Meta pede so digitos. Guardar uma so e apelidar a outra
  -- funciona ate alguem ler a tabela achando que tem a forma da Meta e mandar
  -- o hash do formato errado — que nao casa com nada, em silencio.
  fone_sha256      text,
  fone_digitos_sha256 text,
  nome_sha256      text,
  sobrenome_sha256 text,
  cidade_sha256    text,
  atualizado_em    text not null
);

-- Conversões offline -------------------------------------------------------
-- A fila que devolve ao Google Ads e à Meta o que aconteceu DEPOIS do clique.
-- Mesma disciplina do envio de mensagem: a intenção é gravada antes de tocar a
-- rede, e resposta ambígua vira 'desconhecido', nunca repetição automática —
-- conversão duplicada envenena o aprendizado do algoritmo, e não se desfaz.
create table if not exists conversoes (
  id              text primary key,
  empresa_id      text not null references empresas(id) on delete cascade,
  cliente_id      text not null references clientes(id) on delete cascade,
  oportunidade_id text references oportunidades(id) on delete set null,
  destino         text not null check (destino in ('google_ads','meta_capi')),
  evento          text not null,
  valor_centavos  integer not null default 0,
  moeda           text not null default 'BRL',
  ocorrido_em     text not null,
  status          text not null
                  check (status in ('pendente','enviado','bloqueado','desconhecido',
                                    'falhou','limitado','sem_permissao')),
  motivo          text,
  -- Onde a conversao foi DECLARADA como tendo acontecido. Fica em coluna
  -- propria, e nao so enterrada no JSON do payload, porque e a pergunta que
  -- se faz numa auditoria: "voces disseram a Meta que esta venda foi no
  -- chat?". Ler isso via json_extract de um blob nao e resposta.
  action_source   text,
  payload         text not null default '{}',
  resposta        text,
  -- Diagnostico de envio. fbtrace_id e o numero de protocolo da Meta: sem
  -- ele guardado nao da para perguntar ao suporte por que um evento foi
  -- recusado.
  tentativas      integer not null default 0,
  http_status     integer,
  fbtrace_id      text,
  proxima_tentativa_em text,
  idempotency_key text not null,
  criado_em       text not null,
  enviado_em      text
);
create unique index if not exists ux_conversoes_idem on conversoes(empresa_id, idempotency_key);
create index if not exists ix_conversoes_status on conversoes(empresa_id, status, criado_em);

-- Destinos configurados por empresa ---------------------------------------
create table if not exists destinos_conversao (
  id            text primary key,
  empresa_id    text not null references empresas(id) on delete cascade,
  destino       text not null check (destino in ('google_ads','meta_capi')),
  identificador text not null,
  acao          text,
  ativo         integer not null default 1,
  criado_em     text not null
);
create unique index if not exists ux_destino_conversao on destinos_conversao(empresa_id, destino);

-- Credenciais de integracao, cifradas em repouso (AES-256-GCM).
--
-- O motivo nao e criptografia por criptografia: variavel de ambiente e UMA, e
-- as empresas sao TRES. Cada uma tem conta de anuncio e WABA proprios, e um
-- token de processo so servia a uma delas — em silencio, porque a Graph API
-- apenas responde "nao encontrado" para o anuncio da conta errada.
--
-- Aqui a credencial vive no banco da propria empresa, atras do mesmo
-- empresa_id que separa cliente e pedido. A cifra cobre o caso concreto do
-- backup: VACUUM INTO produz um arquivo que sai da maquina, e sem ela o token
-- viajaria em claro dentro dele.
--
-- valor_claro existe para o que NAO e segredo (dataset id): identificador que
-- precisa ser conferido na tela sem decifrar nada.
create table if not exists credenciais (
  id             text primary key,
  empresa_id     text not null references empresas(id) on delete cascade,
  chave          text not null,
  conteudo       text,
  iv             text,
  tag            text,
  valor_claro    text,
  -- Ultimos quatro caracteres. O bastante para conferir se e o token que a
  -- pessoa acabou de colar, e insuficiente para reconstruir qualquer coisa.
  pista          text,
  atualizado_por text,
  atualizado_em  text not null
);
create unique index if not exists ux_credencial_chave on credenciais(empresa_id, chave);

-- ═══ Vida do veiculo ══════════════════════════════════════════════════════
-- Leitura de hodometro, com data e procedencia.
--
-- A media de km/mes era uma coluna digitada uma vez e nunca revista. Um
-- caminhao que rodava 4.000 km/mes e passou a rodar 1.200 continuava sendo
-- cobrado como se rodasse 4.000 — e a revisao prevista caia meses antes da
-- hora, ensinando o operador a desconfiar da previsao.
--
-- Com o historico, a media e o que o veiculo REALMENTE andou entre duas
-- leituras. E leitura errada se conserta apagando a linha, sem reescrever a
-- historia toda.
create table if not exists veiculo_km (
  id          text primary key,
  empresa_id  text not null references empresas(id) on delete cascade,
  veiculo_id  text not null references veiculos(id) on delete cascade,
  km          integer not null,
  medido_em   text not null,
  -- De onde veio o numero: da OS, da vistoria, ou digitado no balcao.
  origem      text not null default 'manual'
              check (origem in ('manual','ordem_servico','vistoria','importacao')),
  origem_id   text,
  criado_por  text,
  criado_em   text not null
);
create index if not exists ix_km_veiculo on veiculo_km(empresa_id, veiculo_id, medido_em);

-- Plano de manutencao: o que ESTE veiculo precisa, e quando.
--
-- E o que transforma o CRM de registro do que ja aconteceu em previsao do que
-- vai acontecer. Cada linha e um servico com intervalo proprio: filtro de
-- combustivel a cada 20.000 km, bicos a cada 120.000, oleo a cada 6 meses OU
-- 10.000 km — o que vencer primeiro.
create table if not exists planos_manutencao (
  id             text primary key,
  empresa_id     text not null references empresas(id) on delete cascade,
  veiculo_id     text not null references veiculos(id) on delete cascade,
  servico_chave  text not null,
  servico_nome   text not null,
  intervalo_km   integer,
  intervalo_meses integer,
  ultimo_km      integer,
  ultimo_em      text,
  -- Calculados a cada leitura de km. Guardados para a fila poder consultar
  -- sem recalcular a projecao de toda a frota a cada abertura de tela.
  proximo_km     integer,
  previsto_em    text,
  ativo          integer not null default 1,
  criado_em      text not null,
  atualizado_em  text
);
create index if not exists ix_plano_veiculo on planos_manutencao(empresa_id, veiculo_id, ativo);
create index if not exists ix_plano_previsto on planos_manutencao(empresa_id, previsto_em);
create unique index if not exists ux_plano_servico
  on planos_manutencao(empresa_id, veiculo_id, servico_chave);

-- ═══ Vistoria de entrada (check-list) ═════════════════════════════════════
-- A vistoria e o documento que separa "o que ja estava" de "o que a oficina
-- fez". Sem ela, todo arranhao encontrado na entrega vira discussao sem
-- arbitro — e a oficina perde as duas: o cliente e a razao.
--
-- Por isso ela e PRE-SERVICO e tem aceite: a OS so anda depois que o dono
-- concorda com o estado registrado.
create table if not exists vistorias (
  id            text primary key,
  empresa_id    text not null references empresas(id) on delete cascade,
  cliente_id    text not null references clientes(id) on delete cascade,
  veiculo_id    text not null references veiculos(id) on delete cascade,
  ordem_id      text references ordens_servico(id) on delete set null,
  numero        text not null,
  -- Profundidade da revisao: bronze, prata ou ouro. Decide QUAIS itens a
  -- vistoria tem, e fica gravado porque o catalogo pode mudar depois.
  nivel         text not null default 'prata'
                check (nivel in ('bronze','prata','ouro')),
  km            integer,
  nivel_combustivel text,
  status        text not null default 'rascunho'
                check (status in ('rascunho','aguardando_aceite','aceita','recusada','cancelada')),
  tecnico       text,
  observacao    text,
  iniciada_em   text not null,
  concluida_em  text,

  -- Aceite do cliente. conteudo_hash e o que torna o aceite verificavel:
  -- e o resumo do que foi aceito. Alterar um item depois muda o hash, e a
  -- divergencia aparece — o aceite deixa de casar com o documento.
  aceite_em     text,
  aceite_nome   text,
  aceite_cpf    text,
  aceite_meio   text check (aceite_meio in ('assinatura_tela','whatsapp','presencial_verbal')),
  aceite_assinatura text,
  conteudo_hash text,
  recusa_motivo text
);
create index if not exists ix_vistoria_veiculo on vistorias(empresa_id, veiculo_id);
create index if not exists ix_vistoria_status on vistorias(empresa_id, status);
create unique index if not exists ux_vistoria_numero on vistorias(empresa_id, numero);

create table if not exists vistoria_itens (
  id          text primary key,
  empresa_id  text not null references empresas(id) on delete cascade,
  vistoria_id text not null references vistorias(id) on delete cascade,
  grupo       text not null,
  chave       text not null,
  nome        text not null,
  -- Semaforo: verde passa, amarelo observar, vermelho nao roda. na e para o
  -- item que nao existe naquele veiculo — e diferente de nao ter sido olhado.
  estado      text check (estado in ('ok','atencao','critico','na')),
  medida      real,
  unidade     text,
  nota        text,
  posicao     integer not null default 0
);
create index if not exists ix_item_vistoria on vistoria_itens(empresa_id, vistoria_id);
create unique index if not exists ux_item_chave on vistoria_itens(empresa_id, vistoria_id, chave);

-- Foto e video ficam em ARQUIVO, e so o ponteiro no banco.
--
-- Blob em SQLite levaria o banco de 370 KB a gigabytes, e com ele o backup:
-- VACUUM INTO copia o banco inteiro toda madrugada. Com o arquivo de fora,
-- o backup do banco continua em segundos e a midia tem politica propria.
create table if not exists vistoria_midias (
  id          text primary key,
  empresa_id  text not null references empresas(id) on delete cascade,
  vistoria_id text not null references vistorias(id) on delete cascade,
  item_id     text references vistoria_itens(id) on delete cascade,
  tipo        text not null check (tipo in ('foto','video')),
  arquivo     text not null,
  bytes       integer not null default 0,
  largura     integer,
  altura      integer,
  duracao_s   real,
  -- Impede a mesma foto de entrar duas vezes, e prova que o arquivo nao mudou
  -- depois do aceite.
  sha256      text,
  legenda     text,
  criado_por  text,
  criado_em   text not null
);
create index if not exists ix_midia_vistoria on vistoria_midias(empresa_id, vistoria_id);

-- Dimensao de campanha: o nome por tras do source_ad_id.
--
-- Lead de Click-to-WhatsApp NAO TEM UTM. Nao houve navegador, nao houve pagina,
-- nao houve query string — o anuncio abriu a conversa direto, e o que chega no
-- webhook e source_ad_id e ctwa_clid. A tela de origem agrupava por
-- utm_campaign, entao todo lead de anuncio caia em "sem_campanha": a pergunta
-- que paga o anuncio ficava sem resposta justamente no canal onde ha verba.
--
-- Tabela de cache, e nao de verdade: a fonte e o Gerenciador da Meta. Por isso
-- guarda TAMBEM a falha (tentado_em, erro, erro_causa) — sem isso um
-- anuncio apagado seria tentado de novo a cada clique, e cada tentativa custa
-- uma chamada contra o limite da conta.
create table if not exists dimensoes_campanha (
  id             text primary key,
  empresa_id     text not null references empresas(id) on delete cascade,
  source_ad_id   text not null,
  campanha_id    text,
  campanha_nome  text,
  conjunto_id    text,
  conjunto_nome  text,
  anuncio_nome   text,
  situacao       text,
  -- Quando a Meta respondeu com nome. Nulo = nunca resolveu.
  resolvido_em   text,
  -- Quando foi tentado pela ultima vez, com ou sem sucesso.
  tentado_em     text,
  erro           text,
  erro_causa     text,
  atualizado_em  text
);
create unique index if not exists ux_dimensao_anuncio
  on dimensoes_campanha(empresa_id, source_ad_id);

-- Contato adiado: "esse eu falo amanha".
--
-- Sem isto a fila so tinha disparar ou ignorar. Ignorar faz o item voltar
-- identico no dia seguinte, e o operador aprende a desconfiar da lista — que e
-- o pior desfecho possivel para uma tela cujo valor inteiro e ser confiavel.
--
-- O adiamento e por (cliente, gatilho): adiar a revisao de um caminhao nao
-- silencia a cobranca de orcamento do mesmo cliente. Sao conversas diferentes.
create table if not exists adiamentos (
  id            text primary key,
  empresa_id    text not null references empresas(id) on delete cascade,
  cliente_id    text not null references clientes(id) on delete cascade,
  gatilho_chave text not null,
  ate           text not null,
  motivo        text,
  criado_por    text not null,
  criado_em     text not null,
  desfeito_em   text
);
create index if not exists ix_adiamento_ativo
  on adiamentos (empresa_id, cliente_id, gatilho_chave, desfeito_em);
`;

/**
 * Esquema da instância CENTRAL.
 *
 * Ela não é uma empresa. É onde todo lead de toda fonte chega antes de ser
 * roteado, e onde ficam consolidados para leitura única. Tem esquema próprio de
 * propósito: dar a ela as mesmas tabelas de uma empresa convidaria alguém a
 * operar dentro dela, e o isolamento por instância perderia o sentido.
 */
export const SCHEMA_CENTRAL_SQL = `
pragma foreign_keys = on;

create table if not exists leads_consolidados (
  id              text primary key,
  instancia       text not null,
  empresa_nome    text not null,
  cliente_id      text,
  nome            text not null,
  telefone        text,
  email           text,
  cidade          text,
  perfil          text,
  fonte           text not null default 'desconhecida',
  plataforma      text,
  gclid           text,
  fbclid          text,
  utm_campaign    text,
  etapa           text,
  valor_centavos  integer not null default 0,
  consentimento   integer not null default 0,
  criado_em       text not null,
  sincronizado_em text not null
);
create unique index if not exists ux_lead_consolidado on leads_consolidados(instancia, cliente_id);
create index if not exists ix_lead_consolidado_fonte on leads_consolidados(fonte, criado_em);
create index if not exists ix_lead_consolidado_inst on leads_consolidados(instancia, criado_em);

-- Leads que chegam por fonte externa ANTES de existir empresa dona.
-- A central recebe, guarda e roteia; nenhuma instância de empresa fica exposta
-- diretamente a formulário público.
create table if not exists entrada_leads (
  id           text primary key,
  fonte        text not null,
  destino      text,
  payload      text not null default '{}',
  gclid        text,
  fbclid       text,
  utm_campaign text,
  status       text not null default 'recebido'
               check (status in ('recebido','roteado','recusado')),
  motivo       text,
  recebido_em  text not null,
  roteado_em   text
);
create index if not exists ix_entrada_status on entrada_leads(status, recebido_em);

/*
 * Chaves de captação — a porta pública de entrada de lead.
 *
 * Vivem na CENTRAL porque é ela quem recebe tráfego externo; nenhuma instância
 * de empresa fica exposta. A chave diz PARA ONDE o lead vai, e só isso: ela não
 * lê nada, não lista nada e não autentica ninguém. Vazar uma chave permite
 * mandar lead falso para uma empresa — irritante e auditável — nunca ler a base.
 * Por isso pode ficar num HTML público, que é exatamente onde ela precisa estar.
 */
-- Webhook do WhatsApp, gravado ANTES de qualquer processamento.
--
-- Nao existe API para recuperar historico de webhook perdido: o que nao for
-- persistido na chegada some. Por isso o corpo bruto e gravado primeiro e o
-- processamento vem depois, mesmo que o processamento falhe.
create table if not exists webhooks_brutos (
  id            text primary key,
  origem        text not null,
  assinatura_ok integer not null default 0,
  corpo         text not null,
  corpo_hash    text not null unique,
  recebido_em   text not null,
  processado_em text,
  erro          text
);

-- Mensagens recebidas, deduplicadas por wamid.
--
-- A Meta reenvia webhook que nao respondeu 200, com frequencia decrescente por
-- ate 7 dias. Sem chave unica no wamid, cada reenvio vira um lead novo.
create table if not exists mensagens_entrada (
  id              text primary key,
  wamid           text not null unique,
  waba_id         text,
  phone_number_id text,
  wa_id           text,
  nome            text,
  tipo            text,
  texto           text,
  de_anuncio      integer not null default 0,
  ctwa_clid       text,
  source_ad_id    text,
  sem_ctwa        integer not null default 0,
  recebido_em     text not null,
  criado_em       text not null
);
create index if not exists ix_msg_ctwa on mensagens_entrada (ctwa_clid);
create index if not exists ix_msg_wa on mensagens_entrada (wa_id);

create table if not exists chaves_captacao (
  chave        text primary key,
  instancia    text not null,
  codigo       text not null,
  nome         text not null,
  canal        text,
  ativa        integer not null default 1,
  criada_em    text not null,
  ultimo_uso_em text,
  usos         integer not null default 0
);
create index if not exists ix_chaves_codigo on chaves_captacao (codigo);

create table if not exists sincronizacoes (
  id           text primary key,
  instancia    text not null,
  linhas       integer not null default 0,
  iniciado_em  text not null,
  concluido_em text,
  erro         text
);
`;
