import React from 'react';

import StrokeIcon from '../icons/StrokeIcon.jsx';

// What a confirmation popup is about, as its header's icon.
const ICONS = {
  question: { d: ['M9.1 9a3 3 0 0 1 5.8 1c0 2-2.9 2.5-2.9 4', 'M12 17.5h.01', 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z'] },
  warning: { d: ['M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z', 'M12 9v4', 'M12 17h.01'], tone: 'warning' },
  delete: { d: ['M3 6h18', 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2', 'M10 11v6', 'M14 11v6'], tone: 'danger' },
  reset: { d: ['M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8', 'M3 3v5h5'], tone: 'warning' },
  key: { d: ['M21 2l-2 2m-7.6 7.6a5.5 5.5 0 1 1-7.8 7.8 5.5 5.5 0 0 1 7.8-7.8zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4'], tone: 'warning' },
  restore: { d: ['M4 5h6v6H4V5Z', 'M14 5h6v6h-6V5Z', 'M4 15h6v4H4v-4Z', 'M20 17a3 3 0 1 1-1-2.2', 'M20 13v2h-2'] },
  signOut: { d: ['M10 6H6.5A2.5 2.5 0 0 0 4 8.5v7A2.5 2.5 0 0 0 6.5 18H10', 'M14 10l4 4-4 4', 'M18 14H9'], tone: 'warning' },
  running: { d: ['M3 12h4l3-8 4 16 3-8h4'], tone: 'warning' },
  save: { d: ['M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z', 'M17 21v-8H7v8', 'M7 3v5h8'] },
  session: { d: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M12 7v5l3 2'] },
};

// A confirmation's title with its icon. Unknown icons ask a question.
export default function ConfirmTitle({ id, icon = 'question', children }) {
  const { d, tone = 'info' } = Object.hasOwn(ICONS, icon) ? ICONS[icon] : ICONS.question;
  return (
    <span className="linkx_confirm_heading">
      <span className={`linkx_confirm_icon is-${tone}`} data-icon={Object.hasOwn(ICONS, icon) ? icon : 'question'}><StrokeIcon d={d} /></span>
      <span id={id} className="linkx_confirm_title">{children}</span>
    </span>
  );
}
