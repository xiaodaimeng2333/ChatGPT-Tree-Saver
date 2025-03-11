export const SaveButton = ({ onClick }: { onClick: () => void }) => (
  <div className="absolute top-16 right-4 z-10">
    <button
      onClick={onClick}
      className="bg-white p-2 rounded-full shadow-lg mt-2 hover:bg-gray-50 transition-colors"
      title="Save conversation tree"
    >
      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
      </svg>
    </button>
  </div>
); 