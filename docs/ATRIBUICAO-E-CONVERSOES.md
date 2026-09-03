# Atribuição e conversão offline

> Do clique no anúncio à conversão devolvida ao Google e à Meta.
> Ver também [Click-to-WhatsApp](CTWA.md) e [Canais de entrada](CANAIS.md).

## Conversão offline — o circuito completo

A plataforma de anúncio só enxerga até o formulário enviado. Ela não sabe se
aquele lead virou orçamento, sumiu ou comprou oito mil reais. Sem esse retorno,
o algoritmo otimiza para volume de formulário — que é o que enche a agenda de
curioso e esconde o cliente de frota.

```
clique no anúncio  →  gclid / fbclid guardado na entrada  (primeiro toque)
                            ↓
       oportunidade muda de etapa no pipeline
                            ↓
              evento gravado em `event_log`      (nenhum efeito externo aqui)
                            ↓
       worker drena → uma conversão por destino configurado
                            ↓
   compliance avalia: destino? consentimento? identificador? valor?
                            ↓
        payload real do Google Ads e da Meta CAPI é montado
                            ↓
              DEMO_MODE: grava e para · produção: envia
```

O que foi implementado com cuidado, porque erra em silêncio:

- **Primeiro toque nunca se reescreve.** A pessoa pode clicar noutro anúncio
  meses depois; isso não muda de onde ela veio originalmente.
- **Orgânico não vira pago.** `utm_source=google` com `utm_medium=organic` é
  busca orgânica. Classificar como `google_ads` mandaria conversão por um lead
  que nunca clicou em anúncio — ensinando o algoritmo com dado falso.
- **Telefone sai em dois formatos.** Google Ads quer E.164 com `+`; a Meta quer
  só dígitos. Hash da forma errada não casa com nada, e a falha é silenciosa.
- **Gmail é normalizado.** `Joao.Silva+loja@gmail.com` e `joaosilva@gmail.com`
  são a mesma caixa; sem normalizar viram dois hashes e o mesmo cliente conta
  duas vezes.
- **`fbc` é montado a partir do `fbclid`** quando o cookie do Pixel não veio —
  sem isso o `fbclid` sozinho não é lido pela Meta.
- **A data do Google Ads não é ISO.** É `yyyy-MM-dd HH:mm:ss+HH:mm`, com espaço
  no lugar do `T` e fuso explícito.
- **Sem consentimento, nada sai** — nem embaralhado.
- **Resposta ambígua vira `desconhecido`** e nunca é repetida sozinha:
  conversão duplicada envenena o aprendizado e não se desfaz.

O botão **Ver payload**, na tela de Conversões, mostra exatamente o corpo que
iria para cada plataforma. É ele que denuncia um campo faltando antes de a conta
estar ligada.

---
