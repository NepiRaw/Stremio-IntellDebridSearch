/**
 * Controlled-concurrency execution for debrid provider calls, so a large library does not
 * open one request per torrent at once. Concurrency 6 is the measured balance between
 * throughput and staying inside every provider's rate limit.
 */

/**
 * Execute an array of async functions with controlled concurrency.
 * @param {Array<Function>} tasks - Async functions to execute
 * @param {number} concurrency - Maximum tasks running in parallel
 * @returns {Promise<Array>} Settled results, in the order of the input tasks
 */
export async function executeWithControlledConcurrency(tasks, concurrency = 6) {
    if (tasks.length === 0) return [];

    const results = new Array(tasks.length);
    const executing = [];
    let index = 0;

    async function executeTask(taskIndex) {
        try {
            const result = await tasks[taskIndex]();
            results[taskIndex] = { status: 'fulfilled', value: result };
        } catch (error) {
            results[taskIndex] = { status: 'rejected', reason: error };
        }
    }

    while (index < tasks.length) {
        while (executing.length < concurrency && index < tasks.length) {
            const taskPromise = executeTask(index);
            executing.push(taskPromise);
            index++;
        }

        if (executing.length > 0) {
            await Promise.race(executing);

            for (let i = executing.length - 1; i >= 0; i--) {
                const taskPromise = executing[i];
                if (await Promise.race([taskPromise, Promise.resolve('pending')]) !== 'pending') {
                    executing.splice(i, 1);
                }
            }
        }
    }

    await Promise.all(executing);

    return results;
}
