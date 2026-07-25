import React from 'react'
import { INK } from '../theme'

// Small HeyElsie wordmark, top-right of the storyboard scenes (Why / Steps /
// Offer) so the video isn't anonymous. Kept OFF the browser-chrome scenes —
// those play as live screen recordings.

export const Wordmark: React.FC = () => (
  <div
    style={{
      position: 'absolute',
      top: 44,
      right: 48,
      fontSize: 30,
      fontWeight: 900,
      letterSpacing: -0.5,
      color: INK,
      opacity: 0.45,
      zIndex: 50,
    }}
  >
    HeyElsie
  </div>
)
