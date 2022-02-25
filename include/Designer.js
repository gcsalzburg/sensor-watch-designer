//
// Wrapper class for the whole designer
//

class Designer{

	// Default options are below
	_default_opts = {
	};

	_data = {
		sequences: [], // Array of all sequences, order does not matter
		current_sequence: null
	};

	// Information related to current animation playback
	_animation = {
		is_playing: false,
		start_time: 0,

		is_buzzing: false,
		buzzing_freq: 0
	};

	_version = '0.1';
	_index_counter = 0;
	
	// AudioContext for buzzer simulation playback
	audioCtx = new (window.AudioContext || window.webkitAudioContext)();

	constructor(opts) {
		// Merge opts with defaults
		this.opts = {...this._default_opts, ...opts};

		// Save container reference
		this.dom = this.opts.dom;

		// Create an undo handler
		this.undo = new Undo({
			undo_elm: 			document.querySelector(".undo"),
			undoundo_elm: 		document.querySelector(".undoundo"),
			save_to_storage: 	true
		});

		// Load the initial content
		if(this.undo.has_retrieved_from_storage){

			// Load from storage data
			this.load_in_data(this.undo.retrieve());

		}else if(this.opts.data != null){

			// Load from provided data to constructor
			this.load_in_data(this.opts.data);

			// Make this the first history entry
			this.undo.overwrite(this.get_data());

		}else{

			// Create a blank initial sequence
			this.add_sequence();
			this.select_sequence(this._data.sequences[0]);
			this.history_save();

		}

		this._add_handlers();
	}

	// Add a new sequence to the prototyper
	sequence_add(opts = {}){

		const sequence = this._sequence_add(opts);

		this._recalculate_sequence_order();		// We do this whenever the sequence order in the DOM might change
		this._update_trigger_lists();				// Same

		this.sequence_select(sequence, false);	   	// Select the newly formed sequence

		return sequence;
	}

	sequence_select(sequence, save_to_history = true){
		if(sequence != this._data.current_sequence){
			document.querySelectorAll('.sequence_step').forEach((step_dom) => {
				step_dom.classList.remove('active');
			});

			this._data.current_sequence = sequence;
			
			// Highlight the step
			document.querySelectorAll('.sequence').forEach((sq) => {
				sq.classList.remove('active');
			});
			sequence.get_dom().classList.add('active');

			// Save into history but don't make a new step out of it
			if(save_to_history){
				this.undo.overwrite(this.get_data());
			}
		}
	}

	// Delete a sequence at a given index
	sequence_delete(sequence){

		const deleted_id = sequence.get_index();
		sequence.delete();
		for(let i=0; i<this._data.sequences.length; i++){
			if(this._data.sequences[i] == sequence){
				this._data.sequences.splice(i, 1);
			}
		}
		
		// Check if any triggers were pointing towards this and clear them if so
		this._data.sequences.forEach((sequence) => {
			sequence.get_dom().querySelectorAll(".button_select").forEach((select) => {

				if(select.value == deleted_id){
					sequence.set_trigger(select.name, -1);
				}
			});
		});

		this._recalculate_sequence_order();
		this._update_trigger_lists();

		if(this._data.current_sequence == sequence){
			this._data.current_sequence = null;
		}
	}

	// Animation playback
	play(){
		this._animation.start_time = Date.now();
		this._animation.is_playing = true;
		window.requestAnimationFrame(() => this._render_loop());
	}
	pause(){
		this._animation.is_playing = false;
		this._stop_oscillator();
	}
	play_pause(){
		this._animation.is_playing ? this.pause() : this.play();
	}

	// Save the current data
	history_save(){
		const data = this.get_data();
		this.undo.save(data);
	}

	// Undo events
	history_undo(){
		const undo_data = this.undo.undo();
		if(undo_data){
			this.load_in_data(undo_data);
		}
	}
	history_undoundo(){
		const undoundo_data = this.undo.undoundo();
		if(undoundo_data){
			this.load_in_data(undoundo_data);
		}
	}

	// Retrieves array of all data for current setup
	get_data(){
		const data = {
			version: this._version,
			start_time: this._animation.start_time,
			current_sequence_index: this._data.current_sequence?.get_index(),
			sequences: []
		};
		for(let sequence of this._data.sequences){
			data.sequences.push(sequence.get_data());
		}
		return data;
	}

	// Overwrites the whole designer with all the provided data
	load_in_data(data){

		// Reset everything
		this._data.sequences.splice(0, this._data.sequences.length);	// Wipe all sequences
		this.dom.innerHTML = "";													// Empy sequences holder

		// Generate new sequences

		// Sort array by order to get into correct order for DOM
		data.sequences.sort((a, b) => (a.order > b.order) ? 1 : -1);

		for(let sequence_data of data.sequences){
			const new_sequence = this._sequence_add({
				data: sequence_data
			});
			this._index_counter = Math.max(this._index_counter, new_sequence.get_index());
		}
		this._index_counter++;

		// Save animation properties
		this._animation.start_time = data.start_time;

		// Set the current sequence
		if(data.current_sequence_index && this._get_sequence_from_index(data.current_sequence_index)){
			this.sequence_select(this._get_sequence_from_index(data.current_sequence_index));
		}else if(this._data.sequences.length > 0){
			this.sequence_select(this._data.sequences[0]);
		}

		this._recalculate_sequence_order();

		// Update trigger references
		this._update_trigger_lists();
		for(let sequence of this._data.sequences){
			sequence.set_all_triggers();
		}
	}

	//
	// Writes the segment display to the live view of the watch on the screen 
	render_to_live_view(data){

		// Reference for watch element
		const watch = this.opts.live_watch;

		// Fill in all segments 
		for(let group of data.segments){
			switch(group.type){

				case 'digit':
					for(let segment in group.data){
						watch.querySelector(`.${group.digit}`).querySelector(`.${segment}`).classList.toggle('on',group.data[segment]);
					}
					break;

				case 'special':
					for(let segment in group.data){
						watch.querySelector(`.${segment}`).classList.toggle('on',group.data[segment]);
					}
					break;
			}
		}

		// Display lights
		watch.querySelector(`.led_0`).classList.toggle('on',data.hardware.led_0);
		watch.querySelector(`.led_1`).classList.toggle('on',data.hardware.led_1);

		// Play tone
		if(data.hardware.buzzer > 0){
			if(this._animation.buzzing_freq == data.hardware.buzzer){
				// Same frequency as before
				if(!this._animation.is_buzzing){
					// But not buzzing, so start again
					this._create_oscillator(data.hardware.buzzer);
				}
			}else{
				// New frequency, stop and start again
				this._stop_oscillator();
				this._create_oscillator(data.hardware.buzzer);
			}
		}else{
			this._stop_oscillator();
		}
	}

	// //////////////////////////////////////
	// Trigger handling functions

	// Process an incoming button press
	handle_input(button, press_type){
		const action = this._data.current_sequence.get_trigger(button);
		switch(action){

			case '-1':
				// Do nothing
				break;

			case 'play':
				// Play
				this.play();
				break;

			case 'pause':
				// Pause
				this.pause();
				break;

			case 'playpause':
				// Pause
				this.play_pause();
				break;
	
			default:
				// It's a number, so see if we can move to that sequence
				const next_sequence = this._get_sequence_from_index(action);
				if(next_sequence){
					this.sequence_select(next_sequence);
				}
				break;
		}
	}

	// Update all trigger <select> items with correct data
	_update_trigger_lists(){

		// Generate list of triggers
		const sequence_options = this._data.sequences.map(item => ({
			name: `➡ ${item.get_name()}`,
			index: item.get_index(),
			order: item.get_order()
		}));
		sequence_options.sort((a, b) => (a.order > b.order) ? 1 : -1);

		const options = [...[
			{name: "None",	 		index: -1,				order: 0},
			{name: "Play",	 		index: "play",			order: 0},
			{name: "Pause", 		index: "pause",		order: 0},
			{name: "Play/Pause", index: "playpause",	order: 0}
		],...sequence_options];

		// Push list to all select dropdowns
		this._data.sequences.forEach((sequence) => {
			sequence.get_dom().querySelectorAll(".button_select").forEach((select) => {

				// Save current value and wipe
				const current_value = select.value;
				select.innerHTML = "";

				// Add all items
				let has_value_now = false;
				for(let option of options){
					if(option.index == sequence.get_index()){
						// Do not put this sequence in itself
						continue;
					}
					const option_tag = document.createElement('option');
					option_tag.value = option.index;
					option_tag.textContent = option.name;
					if(''+option.index == current_value){
						has_value_now = true;
					} 
					select.append(option_tag);
				}
				// Set the value back
				select.value = has_value_now ? current_value : -1;
			});
		});
	}

	// //////////////////////////////////////
	// Private functions

	//
	// Called via window.requestAnimationFrame()
	_render_loop(){

		if(!this._animation.is_playing){
			return;
		}
		if(!this._data.current_sequence){
			return;
		}

		// Get data for current step of active sequence and display it
		const step = this._data.current_sequence.get_current_step(this._animation.start_time);
		
		// Highlight the step
		document.querySelectorAll('.sequence_step').forEach((step_dom) => {
			step_dom.classList.remove('active');
		});
		step.get_dom().classList.add('active');

		// Render this step
		const step_data = step.get_data();
		this.render_to_live_view(step_data);
 
		// Call again if we want to :)
		if(this._animation.is_playing){
			window.requestAnimationFrame(() => this._render_loop());
		}
	}
	
	// Helper to do the actual add, without triggering anything as well
	_sequence_add(opts){

		const sequence_opts = {
			container:		this.dom,
			name: 			`Sequence ${this._index_counter}`,
			data: 			null,
			index:			++this._index_counter
		};
		const sequence = new Sequence({...sequence_opts, ...opts});
		this._data.sequences.push(sequence);	// Save to the array

		return sequence;
	}

	// Hunt for a sequence in the list from the given index
	_get_sequence_from_index(index){
		for(let sequence of this._data.sequences){
			if(sequence.get_index() == index){
				return sequence;
			}
		}
	}

	// Re-assigns order property to each sequence based on current DOM order
	_recalculate_sequence_order(){
		let o=0;
		this.dom.querySelectorAll(".sequence").forEach((sequence) => {
			let sq = this._get_sequence_from_index(sequence.dataset.index);
			sq.set_order(o);
			o++;
		});
	}

	// //////////////////////////////////////
	// Oscillator helpers

	//
	// Oscillator helpers
	_stop_oscillator(){
		if(this._animation.is_buzzing){
			this.oscillator.stop();
			this._animation.is_buzzing = false;
		}
	}
	_create_oscillator(frequency){
		// Setup buzzer
		this.oscillator = this.audioCtx.createOscillator();
		this.oscillator.type = 'sine';
		this.oscillator.connect(this.audioCtx.destination);
		this.oscillator.frequency.setValueAtTime(frequency, this.audioCtx.currentTime);
		this.oscillator.start();
		this._animation.is_buzzing = true;
		this._animation.buzzing_freq = frequency;
	}

	// //////////////////////////////////////
	// Helper functions

	_add_handlers(){

		// Listener for "updated" triggers to initiate a state save
		this.dom.addEventListener("updated", (e) => {
			this.history_save();
		});

		// Listener for clicking on a sequence to select it
		this.dom.addEventListener("click", (e) => {

			let node = e.target;
			while(node != this.dom){
				if(!node) break;
				if(node.classList.contains('sequence')){

					// Select this one
					this.sequence_select(this._get_sequence_from_index(node.dataset.index));
					break;
				}
				node = node.parentNode;
			}
		});

		// Listener for sequence name changes to update trigger lists
		this.dom.addEventListener("updated_name", (e) => {
			this._update_trigger_lists();
		});

		// Listener for duplicate / delete sequence buttons
		this.dom.addEventListener("click", (e) => {

			// Get the hash, to work out what sort of switch it is
			const url_target = e.target.href;
			if(!url_target){
				return;
			}
			const hash = url_target.substring(url_target.indexOf('#') + 1);
			
			// TODO: Make a common function for this
			let this_sequence = e.target;
			while(this_sequence != this.dom){
				if(!this_sequence){
					return;
				}
				if(this_sequence.classList.contains('sequence')){
					break;
				}
				this_sequence = this_sequence.parentNode;
			}

			switch(hash){

				case "sequence_duplicate":
					e.preventDefault();
					const sq_clone_data = JSON.parse(JSON.stringify(this._get_sequence_from_index(this_sequence.dataset.index).get_data()));
					sq_clone_data.index = ++this._index_counter;
					sq_clone_data.name += ` [${this._index_counter}]`;
					this.sequence_add({
						after: this_sequence,
						data: sq_clone_data
					});
					this.history_save();
					e.target.blur();
					break;

				case "sequence_delete":
					e.preventDefault();
					this.sequence_delete(this._get_sequence_from_index(this_sequence.dataset.index));
					this.history_save();
					e.target.blur();
					break;
			}
		});
	}
}
