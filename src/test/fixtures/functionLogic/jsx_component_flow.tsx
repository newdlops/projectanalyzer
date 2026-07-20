/** TSX Function Logic fixture for component callsites and React wrappers. */

type CardProps = {
  item: { id: string; label: string };
  ready: boolean;
};

export const Badge = ({ label }: { label: string }) => <strong>{label}</strong>;
export const ReadyState = () => <span>Ready</span>;
export const EmptyState = () => <span>Empty</span>;
export const Panel = ({ children }: { children: unknown }) => <div>{children}</div>;

export function formatLabel(label: string): string {
  return label.trim();
}

export function trackSelection(id: string): void {
  console.log(id);
}

export const RenderCard = ({ item, ready }: CardProps) => (
  <section data-label={formatLabel(item.label)}>
    <Badge label={item.label} />
    <UI.Panel>
      {ready ? <ReadyState /> : <EmptyState />}
    </UI.Panel>
    <button onClick={() => trackSelection(item.id)}>Select</button>
  </section>
);

export const MemoCard = memo((props: CardProps) => (
  <RenderCard item={props.item} ready={props.ready} />
));

export const ForwardCard = React.forwardRef<HTMLDivElement, CardProps>(
  function ForwardCardImplementation(props, ref) {
    return <MemoCard ref={ref} item={props.item} ready={props.ready} />;
  }
);

export function CardList({ items }: { items: Array<CardProps["item"] & { ready: boolean }> }) {
  return (
    <div className="card-list">
      {items.map((item) => (
        <RenderCard item={item} ready={item.ready} />
      ))}
    </div>
  );
}

export function ComponentValueShelf({ item, ready }: CardProps) {
  const componentValues = [
    <Badge key="badge" label={item.label} />,
    <ReadyState key="ready" />,
    <EmptyState key="empty" />
  ];
  const selectedComponent = componentValues[ready ? 0 : 2];
  return selectedComponent;
}

export function handleNamedClick(): void {
  trackSelection("named");
}

export const NamedHandlerCard = () => (
  <button onClick={handleNamedClick}>Named</button>
);

export const NestedTernaryCard = ({
  primary,
  secondary,
  cached
}: {
  primary: boolean;
  secondary: boolean;
  cached: boolean;
}) => (
  <section>
    {primary
      ? secondary
        ? <strong>Primary</strong>
        : <em>Secondary</em>
      : cached
        ? <small>Cached</small>
        : <mark>Fallback</mark>}
  </section>
);
