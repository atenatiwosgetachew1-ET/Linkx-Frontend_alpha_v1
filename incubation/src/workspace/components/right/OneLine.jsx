import React, { useLayoutEffect, useRef, useState } from 'react';

// Text kept to one line. When it does not fit, the whole of it is in a
// tooltip (hover, or keyboard focus); when it fits there is none.
export default function OneLine({ as = 'span', className = '', children, ...rest }) {
  const Tag = as;
  const ref = useRef(null);
  const [isCut, setCut] = useState(false);
  const text = [children].flat().filter((part) => part !== null && part !== undefined && part !== false).join('');

  useLayoutEffect(() => {
    const element = ref.current;
    const measure = () => setCut(element.scrollWidth > element.clientWidth);
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [text]);

  return (
    <Tag
      {...rest}
      ref={ref}
      className={['right_line', isCut && 'linkx_tooltip_anchor', className].filter(Boolean).join(' ')}
      data-tooltip={isCut ? text : undefined}
      tabIndex={isCut ? 0 : undefined}
    >
      {text}
    </Tag>
  );
}
