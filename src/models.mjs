// Central catalogue of every QVAC model IO Offline uses.
// Everything here is downloaded once by `npm run setup` (needs internet),
// then loaded from the local cache (~/.qvac/models) with no network at all.
import * as sdk from '@qvac/sdk';

const pick = (name) => {
  const m = sdk[name];
  if (!m) throw new Error(`QVAC model constant ${name} not found in @qvac/sdk`);
  return m;
};

// LLM is switchable: QWEN3_1_7B_INST_Q4 (default, better answers) or
// QWEN3_600M_INST_Q4 (faster on weak laptops).
export const LLM_NAME = process.env.LLM_MODEL || 'QWEN3_1_7B_INST_Q4';

// South African languages run on TranslatePsy-AfriSLM, a small translation LLM in the
// QVAC registry. 2B gives better quality; 0.8B is faster on weak machines.
export const AFRI_NAME = process.env.AFRI_MODEL || 'TRANSLATEPSY_AFRISLM_2B_TRANSLATION_Q4_K_M';

// Offline translation targets. `sa: true` = official South African language.
//  engine 'afri'     → TranslatePsy-AfriSLM (LLM translator), code = NLLB-style tag
//  engine 'bergamot' → Mozilla Bergamot (fast NMT), model = registry constant
export const TRANSLATION_LANGS = {
  af: { label: 'Afrikaans', native: 'Afrikaans', sa: true, engine: 'afri', code: 'afr_Latn' },
  zu: { label: 'isiZulu', native: 'isiZulu', sa: true, engine: 'afri', code: 'zul_Latn' },
  xh: { label: 'isiXhosa', native: 'isiXhosa', sa: true, engine: 'afri', code: 'xho_Latn' },
  st: { label: 'Sesotho', native: 'Sesotho', sa: true, engine: 'afri', code: 'sot_Latn' },
  tn: { label: 'Setswana', native: 'Setswana', sa: true, engine: 'afri', code: 'tsn_Latn' },
  fr: { label: 'French', native: 'Français', engine: 'bergamot', model: 'BERGAMOT_EN_FR' },
  pt: { label: 'Portuguese', native: 'Português', engine: 'bergamot', model: 'BERGAMOT_EN_PT' },
  es: { label: 'Spanish', native: 'Español', engine: 'bergamot', model: 'BERGAMOT_EN_ES' },
  de: { label: 'German', native: 'Deutsch', engine: 'bergamot', model: 'BERGAMOT_EN_DE' },
};

export const MODELS = {
  llm: { label: 'Tutor LLM', name: LLM_NAME },
  embed: { label: 'Embeddings (RAG)', name: 'GTE_LARGE_FP16' },
  asr: { label: 'Speech-to-text', name: 'WHISPER_TINY' },
  tts: { label: 'Text-to-speech', name: 'TTS_EN_SUPERTONIC_Q8_0' },
  afri: { label: 'SA languages translator', name: AFRI_NAME },
};

export function modelSrc(name) {
  return pick(name);
}

export function allDownloadNames() {
  return [
    ...Object.values(MODELS).map((m) => m.name),
    ...Object.values(TRANSLATION_LANGS).filter((l) => l.model).map((l) => l.model),
  ];
}
