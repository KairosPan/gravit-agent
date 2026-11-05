/** Small, pure translations for the bot settings page. */
import { t, saidError } from "../i18n/words.js";

// The settings endpoint currently accepts this exact provider/model grammar.
const MODEL_ROUTE = /^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.:-]*$/;

/** Validate the route accepted by the bot settings endpoint.
 * @param {string} value @returns {string|null} */
export function normalizeBotModel(value) {
  const route = value.trim();
  if (route === "") return null;
  if (!MODEL_ROUTE.test(route)) throw saidError("discover.bot.modelRoute");
  return route;
}

/** @param {any} catalog @returns {{value: string, label: string}[]} */
export function botModelChoices(catalog) {
  const choices = new Map();
  for (const group of Array.isArray(catalog?.groups) ? catalog.groups : []) {
    if (typeof group?.id !== "string") continue;
    for (const model of Array.isArray(group.models) ? group.models : []) {
      if (typeof model?.id !== "string") continue;
      const value = `${group.id}/${model.id}`;
      if (!MODEL_ROUTE.test(value)) continue;
      choices.set(value, { value, label: `${group.name || group.id} · ${model.name || model.id}` });
    }
  }
  return [...choices.values()];
}

/** @param {Record<string, string>} fields @returns {string} */
export function draftBotSoul(fields) {
  const sections = [
    ["Identity and perspective", fields.identity], // en-kept: the soul's headings, the bot's own words (spec §5.10)
    ["Questions I focus on", fields.focus], // en-kept: the soul's headings, the bot's own words (spec §5.10)
    ["Evidence I require", fields.evidence], // en-kept: the soul's headings, the bot's own words (spec §5.10)
    ["What changes my mind", fields.revise], // en-kept: the soul's headings, the bot's own words (spec §5.10)
    ["When I speak or pass", fields.participation], // en-kept: the soul's headings, the bot's own words (spec §5.10)
    ["Communication style", fields.style], // en-kept: the soul's headings, the bot's own words (spec §5.10)
  ];
  return sections.filter(([, text]) => text?.trim()).map(([title, text]) => `## ${title}\n\n${text.trim()}`).join("\n\n");
}

// the tools' words, read from the table at each call
const toolLabels = () => ({
  ask_user_question: t("discover.tool.askUser"), bash: t("discover.tool.bash"), edit: t("discover.tool.edit"), glob: t("discover.tool.glob"),
  grep: t("discover.tool.grep"), read: t("discover.tool.read"), read_image: t("discover.tool.readImage"), skill: t("discover.tool.skill"),
  str_replace_editor: t("discover.tool.replace"), web_search: t("discover.tool.webSearch"), write: t("discover.tool.write"),
});

/** The raw pattern stays visible in the UI; labels never imply access is granted.
 * @param {string} pattern @returns {string} */
export function botToolLabel(pattern) {
  const key = pattern.startsWith("mcp__") ? pattern.split("__").at(-1) : pattern;
  const labels = toolLabels();
  return Object.hasOwn(labels, key) ? labels[key] : pattern;
}

/** @param {Record<string, any>} bot @param {{name:string, description:string, model:string, soul:string}} fields */
export function botSettingsPayload(bot, fields) {
  return {
    id: bot.id,
    revision: bot.revision,
    name: fields.name.trim(),
    description: fields.description.trim(),
    model: normalizeBotModel(fields.model),
    soul: fields.soul,
  };
}
