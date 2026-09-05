# Credenciais por empresa

> Variável de ambiente é **uma**, e as empresas são **três**.

## O problema

`FORTCRM_META_MARKETING_TOKEN` é uma variável do processo. A Minas Peças, a
Agrofort e a Fort Tintas têm contas de anúncio diferentes, WABAs diferentes e,
muitas vezes, agências diferentes.

Com um token de processo, resolver o nome das campanhas funcionava para **uma**
empresa e falhava nas outras duas — **em silêncio**, porque a Graph API apenas
responde *"não encontrado"* para o anúncio de uma conta a que aquele token não
tem acesso. Nada quebra; a tela só nunca preenche.

## O desenho

Cada credencial vive **no banco da própria empresa**, atrás do mesmo
`empresa_id` que já separa cliente e pedido. O isolamento por instância que a
arquitetura inteira aplica passa a valer também para o segredo.

```
credenciais (empresa_id, chave) → conteudo/iv/tag  (AES-256-GCM)
                                → valor_claro      (só o que não é segredo)
                                → pista            (••••2345)
```

| Chave | Para quê | Permissão da Meta |
|---|---|---|
| `meta_marketing_token` | Resolver o nome das campanhas | `ads_read` |
| `meta_capi_token` | Enviar conversão offline | `manage_events` |
| `meta_dataset_id` | Para onde a conversão vai | — (identificador) |

Os dois tokens são **separados de propósito**. Um token único com as duas
permissões é mais cômodo e transforma um vazamento de leitura em permissão de
escrita.

## As decisões

### A cifra existe por causa do backup

`VACUUM INTO` produz um arquivo que **sai da máquina**. Sem cifrar, o token da
Meta viajaria em claro dentro dele. A cifra não protege contra quem já está
dentro do processo — nada protege — e a chave-mestra continua sendo o segredo a
guardar. Ela resolve exatamente um caso, e é um caso real.

### Falta de chave-mestra falha alto

A referência de onde este desenho veio deriva a chave de uma **semente fixa no
código** quando a variável falta. O efeito: "cifrado em repouso" passa a ser
decifrável por qualquer um que leia o repositório — e ninguém é avisado, porque
tudo continua funcionando.

Um cofre que se abre sozinho é pior que nenhum cofre, porque convence quem o usa
de que há proteção. Aqui `FORTCRM_CHAVE_MESTRA` ausente lança, e a mensagem diz
o que falta e como gerar.

### O valor nunca volta para a tela

Nem para quem é soberano. Devolver o segredo ao navegador o espalharia por
cache, histórico e extensão instalada. Quem precisa do valor é o servidor, e ele
já o tem.

A tela recebe: se está definido, **de onde veio** (`instancia` / `ambiente` /
`nenhuma`), quem mudou, quando, e os **quatro últimos caracteres** — o bastante
para conferir se é o token que a pessoa acabou de colar do Gerenciador, e
insuficiente para reconstruir qualquer coisa.

A auditoria segue a mesma regra: grava a pista, nunca o valor. Trilha de
auditoria é exatamente o arquivo que se entrega a terceiro quando algo dá
errado.

### Instância vence ambiente; apagar devolve o piso

A variável continua existindo como piso — instalação de uma empresa só, ou o
período entre subir o sistema e alguém abrir a tela. Mas quem tem três contas
precisa que a da instância mande.

Apagar a credencial da empresa devolve o sistema ao ambiente, **e a tela diz
isso** — senão pareceria que o segredo continuou lá por engano.

### Escrita é de soberano; leitura, de gestor

Trocar uma credencial pode apontar as conversões para outro pixel. A leitura
(que nunca devolve o valor) fica em gestor, para quem cuida da campanha poder
conferir se está configurado sem depender de quem tem a chave.

### Identificador não é segredo

O `dataset_id` fica em `valor_claro`. Cifrar um identificador só atrapalha quem
precisa conferi-lo na tela, e não protege nada: ele aparece no próprio
Gerenciador de Anúncios.

### Chave trocada devolve motivo, não lixo

A tag de autenticação do GCM é o que transforma "banco adulterado" ou "chave
trocada" em **erro**, e não em bytes sem sentido seguindo para a Meta. O erro
que chega à tela diz que a credencial não abre com a chave atual — e pergunta se
ela foi trocada.

## Configuração

```bash
# Uma vez, no servidor
openssl rand -hex 32   # → FORTCRM_CHAVE_MESTRA, em /etc/fortcrm.env (0600, root)
```

O resto é pela tela **Conversões offline → Credenciais desta empresa**, com a
empresa certa selecionada na lateral.

> **Trocar a chave-mestra invalida tudo que já foi guardado.** Não há
> re-cifragem automática: o desenho prefere falhar visível a decifrar em massa
> sem que ninguém tenha pedido. Depois de trocar, cada credencial precisa ser
> colada de novo — e a tela mostra exatamente quais.
