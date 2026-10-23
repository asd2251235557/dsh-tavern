function tavernCastCharacter(cast, name) {
  return (cast || []).find(item => item.name === name || (item.aliases || []).includes(name)) || null
}

// A read-only projection of dialogue annotations, not another saved timeline.
// Silence keeps the cast; a fourth entrant replaces the oldest visible figure.
function foldCastStage(figures, lines, { player, cast = [] } = {}) {
  const result = figures.map(figure => ({ ...figure }))
  for (const line of lines) {
    if (!line.speaker || line.speaker === player) continue
    const character = tavernCastCharacter(cast, line.speaker)
    const speaker = character ? character.name : line.speaker
    const figure = result.find(item => item.speaker === speaker)
    if (figure) figure.emotion = line.emotion
    else {
      result.push({ speaker, emotion: line.emotion })
      if (result.length > 3) result.shift()
    }
  }
  return result
}

export { foldCastStage }
