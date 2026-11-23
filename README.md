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

## Arquivos

- `index.html` — estrutura, HUD e telas
- `style.css` — visual do HUD, adaptado para tela vertical
- `game.js` — lógica do jogo (pista procedural, física, colisões, efeitos e sons sintetizados com Web Audio)
