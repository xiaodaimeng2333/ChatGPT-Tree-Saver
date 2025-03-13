export const RefreshButton = ({ onClick }: { onClick: () => void }) => (
  <div className="absolute top-4 right-4 z-10" style={{ marginTop: '60px' }}>
    <button
      onClick={onClick}
      className="bg-white p-2 rounded-full shadow-lg mt-2 hover:bg-gray-50 transition-colors"
      title="刷新对话"
    >
      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
      </svg>
    </button>
  </div>
);