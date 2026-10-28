// Vérification de la version de Node, volontairement écrite avec une syntaxe très ancienne :
// ce fichier doit pouvoir se charger même sur un Node trop vieux pour le reste du projet,
// afin d'afficher un message clair plutôt qu'une erreur de syntaxe incompréhensible.

export const NODE_MINIMUM = 22;

/**
 * @param {string} version par exemple « 22.23.3 »
 * @returns {string|null} un message en français si la version est trop ancienne, sinon null
 */
export function verifierVersionNode(version) {
  var majeur = Number(String(version).split('.')[0]);
  if (isNaN(majeur) || majeur < NODE_MINIMUM) {
    return 'Node.js ' + version + ' est trop ancien : il faut la version ' + NODE_MINIMUM + ' ou plus. ' +
      'Installe la dernière version sur nodejs.org (bouton « LTS »), puis relance la commande.';
  }
  return null;
}
