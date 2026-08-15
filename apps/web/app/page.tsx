import messages from "../locales/en.json";

export default function Home() {
  return (
    <main>
      <p className="eyebrow">{messages.eyebrow}</p>
      <h1>{messages.title}</h1>
      <p className="principle">{messages.principle}</p>
      <section aria-label={messages.foundationLabel}>
        <span className="status" aria-hidden="true" />
        <div><strong>{messages.foundationTitle}</strong><p>{messages.foundationDetail}</p></div>
      </section>
    </main>
  );
}
