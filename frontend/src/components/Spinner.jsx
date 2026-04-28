import React from 'react';

const SIZES = { sm: 'w-4 h-4', md: 'w-6 h-6', lg: 'w-10 h-10' };
const COLORS = { white: 'text-white', blue: 'text-brand-600', gray: 'text-gray-400' };

export default function Spinner({ size = 'md', color = 'blue' }) {
  return (
    <svg
      className={`animate-spin ${SIZES[size]} ${COLORS[color]}`}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}
