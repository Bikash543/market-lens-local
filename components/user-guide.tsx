'use client';

import {ArrowUpRight, CheckCheck, Download, FileText} from 'lucide-react';
import {ThemeToggle} from './theme-toggle';
import {useFrameTheme} from './frame-theme';
import styles from './user-guide.module.css';

const pdf = '/guides/Market-Lens-User-Guide-and-Rules.pdf';
const topics = [
  ['01', 'Get started', 'Manual refresh, navigation, your watchlist and the background collector.'],
  ['02', 'Understand the signals', 'The six screener checks, overall direction and seven trade-confirmation checks.'],
  ['03', 'Read a trade plan', 'Entry, stop and target references, expiry, fees and slippage.'],
  ['04', 'Review data readiness', 'WAIT, collecting history, partial refreshes, timestamps and provider coverage.'],
];

export default function UserGuide() {
  useFrameTheme();
  return <main className={styles.guide}>
    <header className={styles.header}>
      <span>Market Lens <span aria-hidden="true">/</span> <strong>User Guide</strong></span>
      <ThemeToggle/>
    </header>
    <div className={styles.content}>
      <p className={styles.eyebrow}>YOUR WORKSPACE, EXPLAINED</p>
      <h1>Make sense of every signal.</h1>
      <p className={styles.intro}>Learn how Market Lens works, what its checks mean, and how to review a setup before making a decision.</p>
      <section className={styles.document} aria-labelledby="guide-title">
        <div className={styles.documentIcon}><FileText size={34} aria-hidden="true"/></div>
        <div className={styles.documentInfo}>
          <p className={styles.eyebrow}>PDF USER GUIDE</p>
          <h2 id="guide-title">User guide &amp; signal rules</h2>
          <p>10 pages · Fillable checklist · Edition: 21 October 2026</p>
        </div>
        <div className={styles.actions}>
          <a className={styles.open} href={pdf} target="_blank" rel="noopener noreferrer">Open PDF <ArrowUpRight size={17} aria-hidden="true"/><span className={styles.srOnly}> in a new tab</span></a>
          <a className={styles.download} href={pdf} download="Market-Lens-User-Guide-and-Rules.pdf"><Download size={17} aria-hidden="true"/> Download PDF</a>
        </div>
      </section>
      <p className={styles.fileNote}>Save the PDF to read it offline. To use the fillable checklist, open the downloaded file in a PDF reader that supports forms.</p>
      <h2 className={styles.sectionTitle}>What&apos;s inside</h2>
      <div className={styles.topics}>{topics.map(([number,title,description])=><article key={number}>
        <span className={styles.topicNumber}>{number}</span><h3>{title}</h3><p>{description}</p>
      </article>)}</div>
      <section className={styles.checklist}>
        <CheckCheck size={24} aria-hidden="true"/>
        <div><h2>A checklist you can fill and save</h2><p>Record the coin, exchange, timeframe, data checks and your reasoning on the final page.</p></div>
      </section>
      <p className={styles.note}>This edition documents the implemented rules on its publication date. Rule alignment is not a win probability, and the app does not place orders. Later app releases may update individual rules.</p>
    </div>
  </main>;
}
