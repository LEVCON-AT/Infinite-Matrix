// Wizard-Prompt-Builder (A.4c).
//
// Konvertiert die 5 User-Antworten aus Step 2 in eine kompakte
// user-Nachricht fuer den LLM. Bewusst kurz und nuechtern — der
// System-Prompt sagt schon was zu tun ist.

import type { WizardAnswers } from './wizard-state';

export function buildWizardPrompt(answers: WizardAnswers): string {
  const parts: string[] = [
    'Ich richte gerade meinen Matrix-Workspace ein. Hier meine Antworten zu deinen Fragen:',
    '',
    `Hauptziel: ${answers.goal.trim()}`,
    `Themen die ich strukturieren will: ${answers.topics.trim()}`,
    `Arbeitsweise: ${answers.workStyle.trim()}`,
    `Huerden mit aktuellen Tools: ${answers.hurdles.trim()}`,
    `Meine Rolle: ${answers.role.trim()}`,
    '',
    'Bitte erstelle einen konkreten Workspace-Vorschlag mit dem wizard_propose_structure-Tool.',
  ];
  return parts.join('\n');
}
