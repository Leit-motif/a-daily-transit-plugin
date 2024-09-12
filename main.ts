import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, TFolder } from 'obsidian';
import ICAL from 'ical.js';
import { format } from 'date-fns';
import { TFile } from 'obsidian'; // Ensure you have this import

// Add these type declarations
declare module 'ical.js' {
    export function parse(input: string): unknown;
    export class Component {
        constructor(jCal: unknown);
        getAllSubcomponents(name: string): Component[];
    }
    export class Event {
        constructor(component: Component | unknown);
        summary: string;
        startDate: { toJSDate(): Date };
        endDate: { toJSDate(): Date };
    }
}

interface ICSReaderSettings {
	icsDirectory: string;
}

interface Event {
	summary: string;
	start: Date;
	end: Date;
}

const DEFAULT_SETTINGS: ICSReaderSettings = {
	icsDirectory: ''
}

export default class ICSReaderPlugin extends Plugin {
	settings: ICSReaderSettings;
	events: Event[] = [];

	async onload() {
		await this.loadSettings();
		await this.loadEvents();  // This will run on vault load

		this.addCommand({
			id: 'insert-todays-events',
			name: 'Insert Today\'s Events',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				this.insertTodaysEvents(editor);
			}
		});

		this.addCommand({
			id: 'refresh-ics-events',
			name: 'Refresh ICS Events',
			callback: async () => {
				await this.loadEvents();
				new Notice('ICS events refreshed');
			}
		});

		this.addCommand({
			id: 'get-todays-events-for-templater',
			name: 'Get Today\'s Events (for Templater)',
			callback: () => {
				const todaysEvents = this.getTodaysEvents();
				let eventString = '';
				if (todaysEvents.length === 0) {
					eventString = 'No events for today.';
				} else {
					eventString = '| Time | Event |\n|------|-------|\n';
					todaysEvents.forEach(event => {
						const startTime = format(event.start, 'HH:mm');
						eventString += `| ${startTime} | ${event.summary} |\n`;
					});
				}
				return eventString;
			}
		});

		this.addRibbonIcon('calendar', 'Insert Daily Transits', (evt: MouseEvent) => {
			const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (activeView) {
				this.insertTodaysEvents(activeView.editor);
			} else {
				new Notice('No active markdown view');
			}
		});

		this.addSettingTab(new ICSReaderSettingTab(this.app, this));

		// Expose the getTodaysEvents function globally
		window.getTodaysEventsForTemplater = () => this.getTodaysEventsForTemplater();

		// Expose the function globally
		(window as Window).getTodaysEventsForTemplater = () => this.getTodaysEventsForTemplater();
	}

	async loadEvents() {
		console.log("loadEvents method called");
		const icsDirectory = this.settings.icsDirectory;
		console.log("ICS Directory:", icsDirectory);
		if (!icsDirectory) {
			new Notice('ICS directory not set. Please configure in settings.');
			return;
		}

		try {
			const icsFiles = this.app.vault.getFiles().filter(file => file.path.startsWith(icsDirectory) && file.extension === 'ics');
			console.log("Found ICS files:", icsFiles.map(f => f.path));
			
			this.events = [];
			for (const file of icsFiles) {
				console.log("Processing file:", file.path);
				try {
					const icsData = await this.app.vault.read(file);
					console.log("ICS data length:", icsData.length);
					console.log("ICAL object:", ICAL);
					console.log("ICAL.parse:", ICAL.parse);
					if (typeof ICAL.parse !== 'function') {
						console.error("ICAL.parse is not a function. ICAL object:", ICAL);
						throw new Error("ICAL.parse is not a function");
					}
					const jcalData = ICAL.parse(icsData);
					console.log("jcalData:", jcalData);
					const comp = new ICAL.Component(jcalData);
					const vevents = comp.getAllSubcomponents('vevent');
					console.log("Found events in file:", vevents.length);

					this.events.push(...vevents.map((vevent) => {
						const event = new ICAL.Event(vevent);
						return {
							summary: event.summary,
							start: event.startDate.toJSDate(),
							end: event.endDate.toJSDate()
						};
					}));
				} catch (fileError) {
					console.error(`Error processing file ${file.path}:`, fileError);
				}
			}

			console.log("Total events loaded:", this.events.length);
			new Notice(`Loaded ${this.events.length} events from ICS files.`);
		} catch (error) {
			console.error('Error loading ICS files:', error);
			new Notice('Error loading ICS files. Check console for details.');
		}
	}

	async insertTodaysEvents(editor: Editor) {
		const file = this.app.workspace.getActiveFile();
		let targetDate: Date | null = null; // Initialize targetDate as null

		if (file instanceof TFile) {
			const frontmatter = await this.app.vault.read(file);
			
			// Use a regex to find the date in the frontmatter
			const dateMatch = frontmatter.match(/date:\s*(\d{4}-\d{2}-\d{2})/);
			if (dateMatch) {
				targetDate = new Date(dateMatch[1]);
			}
		}

		// If no date found in frontmatter, use the current date
		if (!targetDate) {
			targetDate = new Date();
		}

		const events = this.getEventsForDate(targetDate); // Get events for the specific date
		const eventString = this.formatEvents(events); // Format events into a string

		editor.replaceSelection(eventString);
	}

	onunload() {
		delete window.getTodaysEventsForTemplater;
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
		console.log("Loaded settings:", this.settings);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	getTodaysEvents(): Event[] {
		const today = new Date();
		return this.events.filter(event => {
			const eventDate = new Date(event.start);
			return eventDate.toDateString() === today.toDateString();
		});
	}

	getTodaysEventsForTemplater(): string {
		const todaysEvents = this.getTodaysEvents();
		let eventString = '';
		if (todaysEvents.length === 0) {
			eventString = 'No events for today.';
		} else {
			eventString = '| Time | Event |\n|------|-------|\n';
			todaysEvents.forEach(event => {
				const startTime = format(event.start, 'HH:mm');
				eventString += `| ${startTime} | ${event.summary} |\n`;
			});
		}
		return eventString;
	}

	// Add this method to get events for a specific date
	getEventsForDate(date: Date): Event[] {
		return this.events.filter(event => {
			const eventDate = new Date(event.start);
			return eventDate.toDateString() === date.toDateString();
		});
	}

	// Add this method to format events into a string
	formatEvents(events: Event[]): string {
		if (events.length === 0) {
			return 'No events for this date.';
		}

		let eventString = '| Time | Event |\n|------|-------|\n';
		events.forEach(event => {
			const startTime = format(event.start, 'HH:mm');
			eventString += `| ${startTime} | ${event.summary} |\n`;
		});

		return eventString;
	}
}

// Extend the Window interface directly in main.ts
declare global {
    interface Window {
        getTodaysEventsForTemplater?: () => string;
    }
}

class ICSReaderSettingTab extends PluginSettingTab {
	plugin: ICSReaderPlugin;

	constructor(app: App, plugin: ICSReaderPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;
		containerEl.empty();
		containerEl.createEl('h2', {text: 'ICS Reader Settings'});

		new Setting(containerEl)
			.setName('ICS Directory')
			.setDesc('Directory containing your .ics files')
			.addText(text => text
				.setPlaceholder('Example: folder1/folder2')
				.setValue(this.plugin.settings.icsDirectory)
				.onChange(async (value) => {
					this.plugin.settings.icsDirectory = value;
					await this.plugin.saveSettings();
				}))
			.addButton(button => button
				.setButtonText('Choose Directory')
				.onClick(() => {
					new FolderSuggestModal(this.app, (folder) => {
						this.plugin.settings.icsDirectory = folder.path;
						this.plugin.saveSettings();
						this.display();
					}).open();
				}));

		// Add this new setting for the refresh button
		new Setting(containerEl)
			.setName('Refresh ICS Events')
			.setDesc('Manually refresh ICS events')
			.addButton(button => button
				.setButtonText('Refresh')
				.onClick(async () => {
					await this.plugin.loadEvents();
					new Notice('ICS events refreshed');
				}));
	}
}

class FolderSuggestModal extends Modal {
	private result: (folder: TFolder) => void;
	private input: HTMLInputElement;

	constructor(app: App, onChoose: (folder: TFolder) => void) {
		super(app);
		this.result = onChoose;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl("h2", { text: "Choose a folder" });

		this.input = contentEl.createEl("input", {
			type: "text",
			value: ""
		});

		const folderList = contentEl.createEl("ul");
		const folders = this.app.vault.getAllLoadedFiles().filter(f => f instanceof TFolder) as TFolder[];

		folders.forEach(folder => {
			const item = folderList.createEl("li");
			item.setText(folder.path);
			item.onClickEvent(() => {
				this.result(folder);
				this.close();
			});
		});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

export {};
