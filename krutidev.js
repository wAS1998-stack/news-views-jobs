/* ==================================================================
   krutidev.js — Kruti Dev 010 <-> Unicode Hindi conversion.
   Used inline by /tools/kruti-dev-to-unicode/ and /tools/unicode-to-kruti-dev/ (runs in the visitor's
   browser; nothing is uploaded) and by Node for tests.

   Kruti Dev -> Unicode: character table and steps adapted from @bharattype/hindi-transliteration
   (MIT License, Copyright (c) 2026 BharatType), with fixes for ॉ and i-matra + anusvara at the end of text.
   Unicode -> Kruti Dev: written for News-Views; every output is checked by converting it back.
   ================================================================== */
(function (root) {
  "use strict";
  // Kruti Dev sequence -> Unicode, applied in this order (longer and special sequences first).
  var K2U = [
    ["ñ","॰"], ["Q+Z","QZ+"], ["sas","sa"], ["aa","a"], [")Z","र्द्ध"], ["ZZ","Z"],
    ["‘","\""], ["’","\""], ["“","'"], ["”","'"], ["å","०"], ["ƒ","१"],
    ["„","२"], ["…","३"], ["†","४"], ["‡","५"], ["ˆ","६"], ["‰","७"],
    ["Š","८"], ["‹","९"], ["¶+","फ़्"], ["d+","क़"], ["[+k","ख़"], ["[+","ख़्"],
    ["x+","ग़"], ["T+","ज़्"], ["t+","ज़"], ["M+","ड़"], ["<+","ढ़"], ["Q+","फ़"],
    [";+","य़"], ["j+","ऱ"], ["u+","ऩ"], ["Ùk","त्त"], ["Ù","त्त्"], ["ä","क्त"],
    ["–","दृ"], ["—","कृ"], ["é","न्न"], ["™","न्न्"], ["=kk","=k"], ["f=k","f="],
    ["à","ह्न"], ["á","ह्य"], ["â","हृ"], ["ã","ह्म"], ["ºz","ह्र"], ["º","ह्"],
    ["í","द्द"], ["{k","क्ष"], ["{","क्ष्"], ["=","त्र"], ["«","त्र्"], ["Nî","छ्य"],
    ["Vî","ट्य"], ["Bî","ठ्य"], ["Mî","ड्य"], ["<î","ढ्य"], ["|","द्य"], ["K","ज्ञ"],
    ["}","द्व"], ["J","श्र"], ["Vª","ट्र"], ["Mª","ड्र"], ["<ªª","ढ्र"], ["Nª","छ्र"],
    ["Ø","क्र"], ["Ý","फ्र"], ["nzZ","र्द्र"], ["æ","द्र"], ["ç","प्र"], ["Á","प्र"],
    ["xz","ग्र"], ["#","रु"], [":","रू"], ["v‚","ऑ"], ["vks","ओ"], ["vkS","औ"],
    ["vk","आ"], ["v","अ"], ["b±","ईं"], ["Ã","ई"], ["bZ","ई"], ["b","इ"],
    ["m","उ"], ["Å","ऊ"], [",s","ऐ"], [",","ए"], ["_","ऋ"], ["ô","क्क"],
    ["d","क"], ["Dk","क"], ["D","क्"], ["[k","ख"], ["[","ख्"], ["x","ग"],
    ["Xk","ग"], ["X","ग्"], ["Ä","घ"], ["?k","घ"], ["?","घ्"], ["³","ङ"],
    ["pkS","चौ"], ["p","च"], ["Pk","च"], ["P","च्"], ["N","छ"], ["t","ज"],
    ["Tk","ज"], ["T","ज्"], [">","झ"], ["÷","झ्"], ["¥","ञ"], ["ê","ट्ट"],
    ["ë","ट्ठ"], ["V","ट"], ["B","ठ"], ["ì","ड्ड"], ["ï","ड्ढ"], ["M+","ड़"],
    ["<+","ढ़"], ["M","ड"], ["<","ढ"], [".k","ण"], [".","ण्"], ["r","त"],
    ["Rk","त"], ["R","त्"], ["Fk","थ"], ["F","थ्"], [")","द्ध"], ["n","द"],
    ["/k","ध"], ["èk","ध"], ["/","ध्"], ["Ë","ध्"], ["è","ध्"], ["u","न"],
    ["Uk","न"], ["U","न्"], ["i","प"], ["Ik","प"], ["I","प्"], ["Q","फ"],
    ["¶","फ्"], ["c","ब"], ["Ck","ब"], ["C","ब्"], ["Hk","भ"], ["H","भ्"],
    ["e","म"], ["Ek","म"], ["E","म्"], [";","य"], ["¸","य्"], ["j","र"],
    ["y","ल"], ["Yk","ल"], ["Y","ल्"], ["G","ळ"], ["o","व"], ["Ok","व"],
    ["O","व्"], ["'k","श"], ["'","श्"], ["\"k","ष"], ["\"","ष्"], ["l","स"],
    ["Lk","स"], ["L","स्"], ["g","ह"], ["È","ीं"], ["z","्र"], ["Ì","द्द"],
    ["Í","ट्ट"], ["Î","ट्ठ"], ["Ï","ड्ड"], ["Ñ","कृ"], ["Ò","भ"], ["Ó","्य"],
    ["Ô","ड्ढ"], ["Ö","झ्"], ["Ø","क्र"], ["Ù","त्त्"], ["Ük","श"], ["Ü","श्"],
    ["‚","ॉ"], ["ks","ो"], ["kS","ौ"], ["k","ा"], ["h","ी"], ["q","ु"],
    ["w","ू"], ["`","ृ"], ["s","े"], ["S","ै"], ["a","ं"], ["¡","ँ"],
    ["%","ः"], ["W","ॅ"], ["•","ऽ"], ["·","ऽ"], ["∙","ऽ"], ["~j","्र"],
    ["~","्"], ["\\","?"], ["+","़"], [" ः",":"], ["^","‘"], ["*","’"],
    ["Þ","“"], ["ß","”"], ["(",";"], ["¼","("], ["½",")"], ["¿","{"],
    ["À","}"], ["¾","="], ["A","।"], ["-","."], ["&","-"], ["Œ","॰"],
    ["]",","], ["~ ","् "], ["@","/"],
  ];

  function moveBefore(text, marker, sign) {
    // Kruti Dev types the short i-matra (and i-matra + anusvara) BEFORE the consonant it belongs to.
    var p = text.indexOf(marker);
    while (p !== -1 && p + marker.length < text.length) {
      var next = text.charAt(p + marker.length);
      text = text.slice(0, p) + next + sign + text.slice(p + marker.length + 1);
      p = text.indexOf(marker, p + 1);
    }
    return text.split(marker).join(sign);   // a marker at the very end of the text
  }

  function toUnicode(input) {
    if (!input) return "";
    // Kruti Dev's curly quotes stand for " and ', which are also Kruti letters (ष् and श्): park them until the end.
    var text = String(input).replace(/[‘’]/g, "\uE010").replace(/[“”]/g, "\uE011"), i;
    for (i = 0; i < K2U.length; i++) text = text.split(K2U[i][0]).join(K2U[i][1]);
    text = text.split("±").join("Zं").split("Æ").join("र्f");
    text = text.split("Ç").join("fa").split("É").join("र्fa");
    text = moveBefore(text, "fa", "िं");
    text = moveBefore(text, "f", "ि");
    text = text.split("Ê").join("ीZ");
    // an i-matra that landed before a half consonant belongs after the full consonant that follows it
    var w = text.indexOf("ि्");
    while (w !== -1 && w + 2 < text.length) {
      text = text.slice(0, w) + "्" + text.charAt(w + 2) + "ि" + text.slice(w + 3);
      w = text.indexOf("ि्", w + 2);
    }
    // reph: Kruti Dev types it after the syllable it sits on
    var marks = "ािीुूृेैोौंःँॅ़ॉ";
    var r = text.indexOf("Z");
    while (r > 0) {
      var s = r - 1;
      while (s > 0 && marks.indexOf(text.charAt(s)) !== -1) s--;
      while (s >= 2 && text.charAt(s - 1) === "्") s -= 2;
      text = text.slice(0, s) + "र्" + text.slice(s, r) + text.slice(r + 1);
      r = text.indexOf("Z");
    }
    text = text.replace(/Z/g, "").replace(/[​-‍﻿]/g, "");
    return text.normalize("NFC").split("ाॅ").join("ॉ").split("आॅ").join("ऑ").replace(/\uE010/g, "\"").replace(/\uE011/g, "'");
  }

  /* ---- Unicode -> Kruti Dev ---- */
  var FULL = { "क": "d", "ख": "[k", "ग": "x", "घ": "?k", "ङ": "³", "च": "p", "छ": "N", "ज": "t", "झ": ">", "ञ": "¥",
    "ट": "V", "ठ": "B", "ड": "M", "ढ": "<", "ण": ".k", "त": "r", "थ": "Fk", "द": "n", "ध": "/k", "न": "u",
    "प": "i", "फ": "Q", "ब": "c", "भ": "Hk", "म": "e", "य": ";", "र": "j", "ल": "y", "ळ": "G", "व": "o",
    "श": "'k", "ष": "\"k", "स": "l", "ह": "g" };
  var HALF = { "क": "D", "ख": "[", "ग": "X", "घ": "?", "च": "P", "ज": "T", "झ": "÷", "ण": ".", "त": "R", "थ": "F",
    "ध": "/", "न": "U", "प": "I", "फ": "¶", "ब": "C", "भ": "H", "म": "E", "य": "¸", "ल": "Y", "व": "O",
    "श": "'", "ष": "\"", "स": "L", "ह": "º" };
  var U2K = {
    "क्ष्": "{", "त्र्": "«", "त्त्": "Ù", "न्न्": "™", "क्ष": "{k", "त्र": "=", "ज्ञ": "K", "श्र": "J", "द्य": "|", "द्व": "}",
    "द्ध": ")", "द्द": "í", "त्त": "Ùk", "क्त": "ä", "न्न": "é", "ह्न": "à", "ह्य": "á", "ह्म": "ã", "ह्र": "ºz", "क्र": "Ø",
    "फ्र": "Ý", "द्र": "æ", "ट्र": "Vª", "ड्र": "Mª", "छ्र": "Nª", "ट्ट": "ê", "ट्ठ": "ë", "ड्ड": "ì", "ड्ढ": "ï", "क्क": "ô",
    "छ्य": "Nî", "ट्य": "Vî", "ठ्य": "Bî", "ड्य": "Mî", "ढ्य": "<î", "दृ": "–", "कृ": "—", "हृ": "â", "रु": "#", "रू": ":",
    "क़": "d+", "ख़": "[+k", "ग़": "x+", "ज़": "t+", "ड़": "M+", "ढ़": "<+", "फ़": "Q+", "य़": ";+", "ऱ": "j+", "ऩ": "u+",
    "ख़्": "[+", "ज़्": "T+", "फ़्": "¶+",
    "ईं": "b±", "ऑ": "v‚", "ओ": "vks", "औ": "vkS", "आ": "vk", "अ": "v", "ई": "bZ", "इ": "b", "उ": "m", "ऊ": "Å",
    "ऐ": ",s", "ए": ",", "ऋ": "_",
    "ा": "k", "ी": "h", "ु": "q", "ू": "w", "ृ": "`", "े": "s", "ै": "S", "ो": "ks", "ौ": "kS", "ं": "a", "ँ": "¡",
    "ः": "%", "ॅ": "W", "ॉ": "‚", "़": "+", "्र": "z", "्": "~", "ऽ": "•", "।": "A", "॥": "AA", "॰": "ñ",
    "०": "å", "१": "ƒ", "२": "„", "३": "…", "४": "†", "५": "‡", "६": "ˆ", "७": "‰", "८": "Š", "९": "‹",
    ".": "-", ",": "]", "-": "&", "?": "\\", ";": "(", "(": "¼", ")": "½", "{": "¿", "}": "À", "=": "¾", "/": "@",
    ":": " %", "‘": "^", "’": "*", "“": "Þ", "”": "ß", "\"": "‘", "'": "“", "–": "&", "—": "&",
    "ं": "±", "": "Z", "": "f"
  };
  var c;
  for (c in FULL) if (!U2K[c]) U2K[c] = FULL[c];
  for (c in FULL) if (!U2K[c + "्"]) U2K[c + "्"] = HALF[c] || FULL[c] + "~";
  for (c in FULL) if (!U2K[c + "्र"]) U2K[c + "्र"] = FULL[c] + "z";   // rakar goes under the full letter: प्र = iz
  var MAXLEN = 0;
  for (c in U2K) if (c.length > MAXLEN) MAXLEN = c.length;

  var isC = function (ch) { return ch >= "क" && ch <= "ह"; };
  var isSign = function (ch) { return ch >= "ा" && ch <= "ौ" || ch === "ॢ" || ch === "ॣ"; };

  function toKruti(input) {
    if (!input) return "";
    var s = String(input).normalize("NFC").replace(/[​-‍﻿]/g, "")
      .replace(/ऩ/g, "ऩ").replace(/ऱ/g, "ऱ").replace(/ऴ/g, "ऴ");
    var a = Array.from(s), i, j;
    // 1. reph (र् + consonant): Kruti Dev types it after the syllable's vowel signs, before ं / ँ
    for (i = 0; i < a.length - 2; i++) {
      if (a[i] !== "र" || a[i + 1] !== "्" || !isC(a[i + 2]) || (i > 0 && a[i - 1] === "्")) continue;
      j = i + 3;
      if (a[j] === "़") j++;
      while (a[j] === "्" && isC(a[j + 1])) { j += 2; if (a[j] === "़") j++; }
      while (j < a.length && isSign(a[j])) j++;
      a.splice(j, 0, "");
      a.splice(i, 2);
      i = j - 2;
    }
    // 2. short i-matra: typed before the whole consonant cluster
    for (i = 0; i < a.length; i++) {
      if (a[i] !== "ि") continue;
      var st = i - 1;
      if (a[st] === "़") st--;
      if (st < 0 || !isC(a[st])) continue;
      for (;;) {
        if (st >= 2 && a[st - 1] === "्" && isC(a[st - 2])) st -= 2;
        else if (st >= 3 && a[st - 1] === "्" && a[st - 2] === "़" && isC(a[st - 3])) st -= 3;
        else break;
      }
      a.splice(i, 1);
      a.splice(st, 0, "");
    }
    // 3. longest-match mapping
    var out = "", t = a.join(""), k = 0;
    while (k < t.length) {
      var hit = false;
      for (var len = Math.min(MAXLEN, t.length - k); len > 0; len--) {
        var piece = t.substr(k, len);
        if (Object.prototype.hasOwnProperty.call(U2K, piece)) { out += U2K[piece]; k += len; hit = true; break; }
      }
      if (!hit) { out += t.charAt(k); k++; }
    }
    return out;
  }

  var api = { toUnicode: toUnicode, toKruti: toKruti };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.KrutiDev = api;
})(typeof self !== "undefined" ? self : this);
