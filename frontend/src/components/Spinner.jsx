const Spinner = ({ full = false }) => {
  const spinner = (
    <div className="relative h-10 w-10" role="status" aria-label="Loading">
      <div className="absolute inset-0 rounded-full border-2 border-line" />
      <div className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-r-crimson-alt border-t-crimson-soft" />
    </div>
  );
  if (full) {
    return <div className="flex min-h-[50vh] items-center justify-center">{spinner}</div>;
  }
  return <div className="flex justify-center py-8">{spinner}</div>;
};

export default Spinner;
