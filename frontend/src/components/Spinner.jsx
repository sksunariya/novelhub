const Spinner = ({ full = false }) => {
  const spinner = (
    <div className="h-10 w-10 animate-spin rounded-full border-2 border-line border-t-crimson" role="status" aria-label="Loading" />
  );
  if (full) {
    return <div className="flex min-h-[50vh] items-center justify-center">{spinner}</div>;
  }
  return <div className="flex justify-center py-8">{spinner}</div>;
};

export default Spinner;
