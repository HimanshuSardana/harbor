"use client";

import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export default function Home() {
	const [name, setName] = useState("");
	const [greeting, setGreeting] = useState("");

	async function handleGreet() {
		if (!name.trim()) return;
		const msg = await invoke<string>("greet", { name });
		setGreeting(msg);
	}

	return (
		<main className="flex min-h-screen flex-col items-center justify-center gap-8 p-8">
			<h1 className="text-4xl font-bold">Welcome to Harbor</h1>
			<p className="text-lg text-neutral-600">A vim-inspired GUI mail client</p>

			<div className="flex flex-col items-center gap-4">
				<input
					className="rounded border border-neutral-300 px-4 py-2 text-center text-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
					type="text"
					placeholder="Enter your name"
					value={name}
					onChange={(e) => setName(e.target.value)}
					onKeyDown={(e) => e.key === "Enter" && handleGreet()}
				/>
				<button
					className="rounded bg-blue-600 px-6 py-2 text-lg font-medium text-white transition hover:bg-blue-700 active:scale-95"
					onClick={handleGreet}
				>
					Greet me!
				</button>

				{greeting && (
					<p className="mt-4 rounded bg-green-50 px-6 py-3 text-xl font-semibold text-green-700 shadow">
						{greeting}
					</p>
				)}
			</div>
		</main>
	);
}
