type IconProps = { size?: number };

function Svg({ size = 16, children }: IconProps & { children: React.ReactNode }) {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={2}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
		>
			{children}
		</svg>
	);
}

export const CheckIcon = (props: IconProps) => (
	<Svg {...props}>
		<path d="M20 6 9 17l-5-5" />
	</Svg>
);

export const CopyIcon = (props: IconProps) => (
	<Svg {...props}>
		<rect x="9" y="9" width="13" height="13" rx="2" />
		<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
	</Svg>
);

export const LockIcon = (props: IconProps) => (
	<Svg {...props}>
		<rect x="3" y="11" width="18" height="11" rx="2" />
		<path d="M7 11V7a5 5 0 0 1 10 0v4" />
	</Svg>
);

export const LogOutIcon = (props: IconProps) => (
	<Svg {...props}>
		<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
		<path d="m16 17 5-5-5-5" />
		<path d="M21 12H9" />
	</Svg>
);

export const AlertIcon = (props: IconProps) => (
	<Svg {...props}>
		<circle cx="12" cy="12" r="10" />
		<path d="M12 8v4" />
		<path d="M12 16h.01" />
	</Svg>
);

export const InboxIcon = (props: IconProps) => (
	<Svg {...props}>
		<path d="M22 12h-6l-2 3h-4l-2-3H2" />
		<path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
	</Svg>
);
