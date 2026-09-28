import { randomInt } from "node:crypto";

// Formatos aceitos:
//   /2d6            -> soma os dados
//   /1d5+5          -> soma + bonus
//   /2d6-3          -> subtrai (pode ficar negativo)
//   /2d6+           -> mostra apenas o MAIOR dado rolado
//   /2d6+5+d8+      -> varios grupos de dados: rola todos, pega o MAIOR de
//                      todos e soma o bonus (+5). O comando termina com +.
//   /1d10+3+d5-1+   -> modo maior: soma/subtrai TODOS os numeros soltos
//                      (+3 -1 = +2), independente da ordem.
//   /2d15+1d6       -> soma os resultados finais dos dois grupos
//   /1d10+d5-2d4    -> soma 1d10 + d5 e SUBTRAI a soma do 2d4
//   /10d20+5        -> (termina com numero) soma tudo + bonus, como sempre
// Espacos sao ignorados. D maiusculo ou minusculo. Sem limite de dados/faces.
const TERM_RE = /([+-]?)(?:(\d*)[dD](\d+)|(\d+))/g;

// Acima disso nao vale a pena rolar dado a dado: usamos uma aproximacao exata
// por soma (media * quantidade) so para casos absurdos.
const MAX_ROLLED = 200000;

function rollOnce(faces) {
  // faces pode ser BigInt (numeros gigantes)
  if (typeof faces === "bigint") {
    // gera um BigInt uniforme em [1, faces]
    const bits = faces.toString(2).length;
    const bytes = Math.ceil(bits / 8);
    while (true) {
      const buf = new Uint8Array(bytes);
      for (let i = 0; i < bytes; i++) buf[i] = randomInt(0, 256);
      let value = 0n;
      for (const b of buf) value = (value << 8n) | BigInt(b);
      value %= faces;
      return value + 1n;
    }
  }
  return randomInt(1, faces + 1);
}

// Interpreta o corpo do comando (sem a /) numa lista de termos:
// grupos de dados (qty d faces) e numeros (modificadores com sinal).
// Retorna { groups: [{qty, faces}], modifier, keepHighest } ou null.
function parseBody(body, keepHighest) {
  const compact = body.replace(/\s+/g, "");
  if (!compact) return null;

  const groups = [];
  let modifier = 0n;
  let last = 0;
  let anyTerm = false;
  let anyDice = false;

  TERM_RE.lastIndex = 0;
  let m;
  while ((m = TERM_RE.exec(compact)) !== null) {
    if (m.index !== last) return null; // caractere invalido no meio
    const [, signRaw, qtyRaw, facesRaw, numRaw] = m;
    const negative = signRaw === "-";
    if (facesRaw !== undefined) {
      const qty = qtyRaw === "" ? 1n : BigInt(qtyRaw);
      const faces = BigInt(facesRaw);
      if (qty === 0n || faces === 0n) return null;
      groups.push({ qty, faces, negative });
      anyDice = true;
    } else {
      const value = BigInt(numRaw);
      modifier += negative ? -value : value;
    }
    anyTerm = true;
    last = TERM_RE.lastIndex;
  }
  if (!anyTerm || last !== compact.length) return null;
  if (!anyDice) return null; // so numero, sem dado: ignora (como antes)

  return { groups, modifier, keepHighest };
}

export function parseCommand(text) {
  let s = String(text ?? "").trim();
  if (!s.startsWith("/")) return null;

  // Termina com + (sem numero depois): modo "escolhe o maior dado".
  const keepHighest = /\+\s*$/.test(s);
  if (keepHighest) s = s.replace(/\+\s*$/, "");

  const body = s.slice(1);
  return parseBody(body, keepHighest);
}

export function roll(text) {
  const parsed = parseCommand(text);
  if (!parsed) return null;
  const { groups, modifier, keepHighest } = parsed;

  let total = 0n; // soma de tudo (modo normal)
  let best = 0n; // maior dado rolado (modo termina com +)

  for (const { qty, faces, negative } of groups) {
    const bigFaces = faces > BigInt(Number.MAX_SAFE_INTEGER) ? faces : Number(faces);
    const sign = negative ? -1n : 1n;

    if (qty > BigInt(MAX_ROLLED)) {
      // Quantidade enorme: soma estatistica exata via media, sem travar o processo.
      // No modo "maior", a aproximacao do maior dado e o proprio valor maximo.
      total += sign * ((qty * (faces + 1n)) / 2n);
      if (faces > best) best = faces;
      continue;
    }

    const n = Number(qty);
    for (let i = 0; i < n; i++) {
      const value = rollOnce(bigFaces);
      const asBig = typeof value === "bigint" ? value : BigInt(value);
      total += sign * asBig;
      if (asBig > best) best = asBig;
    }
  }

  // Comando terminando com +: o resultado e o MAIOR dado rolado entre todos
  // os grupos, mais o bonus/modificadores. Caso contrario, a soma de tudo.
  const grandTotal = keepHighest ? best + modifier : total + modifier;

  return { groups, modifier, keepHighest, total, grandTotal };
}

export function formatResult(_command, result) {
  // Resposta curta: apenas o resultado final (ja com o modificador aplicado).
  return `${result.grandTotal}`;
}
