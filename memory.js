class Memory {
    constructor() {
        console.log("Memory Initialized");
    }

    read(address) {
        console.log(`Reading from memory address: ${address}`);
        return 0;
    }

    write(address, value) {
        console.log(`Writing ${value} to memory address: ${address}`);
    }
}
