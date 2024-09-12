declare module 'ical.js' {
    namespace ICAL {
        type JCalData = Array<string | number | JCalData>;

        class Component {
            constructor(jCal: JCalData | string);
            name: string;
            getAllSubcomponents(name?: string): Component[];
        }

        class Event {
            constructor(component?: Component | null, options?: {strictExceptions: boolean});
            summary: string;
            description: string;
            startDate: Time;
            endDate: Time;
        }

        class Time {
            toJSDate(): Date;
        }

        function parse(input: string): JCalData;
    }

    export default ICAL;
}