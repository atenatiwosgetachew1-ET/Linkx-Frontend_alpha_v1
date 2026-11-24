import React from 'react';

// The look of the graph benchmark pages (the GPU benchmark of Libraries ▸
// Graph rendering, and the developer one): the Linkx header, a side column
// and the stage, in the active theme (styles/features/benchmark.css).

const LOGO = `${import.meta.env.BASE_URL}site_images/Linkx square Icon (256x256).png`;

export function BenchmarkFrame({ title, subtitle, actions, side, children, className = '', ...rest }) {
  return (
    <div className={`linkx_bench${className ? ` ${className}` : ''}`} {...rest}>
      <header className="linkx_bench_header">
        <img src={LOGO} alt="Linkx logo" />
        <span className="linkx_bench_brand">
          <strong>Linkx</strong>
          <small>Web analyzer</small>
        </span>
        <span className="linkx_bench_title">
          <h1>{title}</h1>
          {subtitle ? <p>{subtitle}</p> : null}
        </span>
        {actions ? <span className="linkx_bench_actions">{actions}</span> : null}
      </header>
      <div className="linkx_bench_body">
        <aside className="linkx_bench_side">{side}</aside>
        <main className="linkx_bench_main">{children}</main>
      </div>
    </div>
  );
}

export function BenchmarkCard({ title, children, className = '', ...rest }) {
  return (
    <section className={`linkx_bench_card${className ? ` ${className}` : ''}`} {...rest}>
      {title ? <h2>{title}</h2> : null}
      {children}
    </section>
  );
}
