# Sky Drift

Demo jogável de um jogo mobile de carrinho numa pista laranja suspensa sobre as nuvens, feito com **Three.js** (HTML + CSS + JavaScript, sem modelos nem imagens externas).

O desafio é se manter na pista: ela não tem proteção nas bordas, tem trechos estreitos, zigue-zagues, bifurcações e buracos.

## Jogar

- Online: https://johnathangomesdev.github.io/sky-drift/
- Local: abra `index.html` no navegador (precisa de internet para carregar o Three.js pelo CDN).

## Controles

| Ação | Celular | Computador |
|---|---|---|
| Acelerar | Arrastar o dedo para cima | Segurar ↑ / W |
| Frear | Arrastar o dedo para baixo | ↓ / S |
| Virar | Arrastar para os lados | ← → / A D (ou arrastar com o mouse) |
| Pausar | Botão de pausa | P / Esc |

O carro só muda de direção quando você vira: nas curvas, quem esterça é você.

- **Tela inicial:** mostra a pista no começo da última fase jogada; não há botão "jogar", arrastar para cima já larga a fase. Botões: carro (garagem), ranking e configurações (engrenagem).
- **Vidas:** 3 galões de gasolina. Caiu ou bateu, perde um galão e volta para o ponto de retorno (arco verde no meio da fase) ou para a largada da fase. Sem galões, fim de jogo.
- **Ranking e configurações** ficam salvos no aparelho (localStorage).
- A versão carregada aparece no canto superior direito (`VERSION` no `game.js` + `?v=` no `index.html`).

## Arquivos

- `index.html` — estrutura, HUD e telas
- `style.css` — visual do HUD, adaptado para tela vertical
- `game.js` — lógica do jogo (pista procedural, física, colisões, efeitos e sons sintetizados com Web Audio)
